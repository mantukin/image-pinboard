#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Emitter};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use thread_priority::{ThreadPriority, set_current_thread_priority};
use tokio::time::sleep as async_sleep;

mod db;
mod image_handler;

struct ThumbnailJob {
    hash: String,
    file_path: String,
}

struct AppState {
    job_queue: Arc<Mutex<VecDeque<ThumbnailJob>>>,
}

#[derive(serde::Deserialize)]
struct CanvasItemInput {
    hash: String,
    x: f64,
    y: f64,
    scale: f64,
    width: f64,
    height: f64,
    z_index: i64,
}

#[derive(serde::Deserialize)]
struct CanvasNoteInput {
    id: String,
    text: String,
    color: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: i64,
    font_size: f64,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn sanitize_note_color(input: &str) -> String {
    let value = input.trim();
    if value.len() == 7
        && value.starts_with('#')
        && value.chars().skip(1).all(|ch| ch.is_ascii_hexdigit())
    {
        value.to_string()
    } else {
        "#fef08a".to_string()
    }
}

#[tauri::command]
async fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("Only supported on Windows".to_string())
    }
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // Escape & properly or just let cmd start handle it if quoting: cmd /C start "" "url"
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("Only supported on Windows".to_string())
    }
}

#[tauri::command]
async fn start_drag(app: tauri::AppHandle, window: tauri::WebviewWindow, path: String, hash: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("File does not exist".to_string());
    }

    let path_buf = std::path::PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    let mut clean_path = path_buf.to_string_lossy().to_string();
    if clean_path.starts_with(r"\\?\") {
        clean_path = clean_path[4..].to_string();
    }
    
    // Determine preview icon path (Send-safe PathBuf)
    let drag_file_path = std::path::PathBuf::from(&clean_path);
    let preview_path = if let Some(parent) = drag_file_path.parent() {
        let thumb_path = parent.join("thumbnails").join("thumb.webp");
        if thumb_path.exists() {
            thumb_path
        } else {
            drag_file_path.clone()
        }
    } else {
        drag_file_path.clone()
    };

    // Create a temporary file with a simple name for drag-and-drop
    // Use first 4 characters of hash to avoid conflicts
    let extension = drag_file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    
    let hash_prefix = if hash.len() >= 4 {
        &hash[..4]
    } else {
        &hash
    };
    
    let temp_dir = std::env::temp_dir();
    let simple_filename = format!("image_{}.{}", hash_prefix, extension);
    let temp_file_path = temp_dir.join(&simple_filename);
    
    // Copy the original file to temp location with simple name
    fs::copy(&drag_file_path, &temp_file_path).map_err(|e| e.to_string())?;
    
    println!("📁 Created temp file for drag: {}", temp_file_path.display());
    
    let file_path_for_drag = temp_file_path.clone();
    
    // CRITICAL: DoDragDrop (Windows OLE) MUST run on the main (STA) thread.
    // Running it in a tokio thread causes browsers and other apps to reject the drag.
    // This is exactly how tauri-plugin-drag does it internally.
    let (tx, rx) = std::sync::mpsc::channel();
    
    app.run_on_main_thread(move || {
        // Build DragItem and Image INSIDE the closure to avoid Send issues
        // (drag::DragItem::Data contains Box<dyn Fn> which is !Send,
        //  but the enum as a whole is !Send even if we only use Files variant)
        let item = drag::DragItem::Files(vec![file_path_for_drag.clone()]);
        let preview_icon = drag::Image::File(preview_path);
        
        let result = drag::start_drag(
            &window,
            item,
            preview_icon,
            move |result, _cursor_pos| {
                println!("Drag result: {:?}", result);
                // Don't delete immediately - web forms and other apps need time to read/upload the file
                // Schedule cleanup after 30 seconds to give apps enough time
                let cleanup_path = file_path_for_drag.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(30));
                    let _ = fs::remove_file(&cleanup_path);
                    println!("Cleaned up temp file: {:?}", cleanup_path);
                });
            },
            Default::default(),
        );
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    
    rx.recv()
        .map_err(|e| format!("Failed to receive drag result: {}", e))?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_images(
    app: tauri::AppHandle,
    limit: i32,
    offset: i32,
) -> Result<Vec<db::ImageRecord>, String> {
    let db_path = get_db_path(&app)?;
    db::get_images_paged(&db_path, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_canvas_layout(app: tauri::AppHandle) -> Result<Vec<db::CanvasLayoutRecord>, String> {
    let db_path = get_db_path(&app)?;
    db::get_canvas_layout(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_canvas_layout(
    app: tauri::AppHandle,
    items: Vec<CanvasItemInput>,
) -> Result<(), String> {
    let db_path = get_db_path(&app)?;

    for item in items {
        db::upsert_canvas_item(
            &db_path,
            &item.hash,
            item.x,
            item.y,
            item.scale.max(0.05),
            item.width.max(128.0),
            item.height.max(128.0),
            item.z_index,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn get_canvas_notes(app: tauri::AppHandle) -> Result<Vec<db::CanvasNoteRecord>, String> {
    let db_path = get_db_path(&app)?;
    db::get_canvas_notes(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_canvas_notes(
    app: tauri::AppHandle,
    items: Vec<CanvasNoteInput>,
) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    let updated_at = now_ts();

    for item in items {
        db::upsert_canvas_note(
            &db_path,
            &item.id,
            &item.text,
            &sanitize_note_color(&item.color),
            item.x,
            item.y,
            item.width.max(128.0),
            item.height.max(128.0),
            item.z_index,
            item.font_size,
            updated_at,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn delete_canvas_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    db::delete_canvas_note(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_canvas_drawings(app: tauri::AppHandle) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_data.join("drawings.json");
    if path.exists() {
        fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Ok("[]".to_string())
    }
}

#[tauri::command]
async fn save_canvas_drawings(app: tauri::AppHandle, drawings: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let path = app_data.join("drawings.json");
    fs::write(path, drawings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_app_settings(app: tauri::AppHandle) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_data.join("settings.json");
    if path.exists() {
        fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
async fn save_app_settings(app: tauri::AppHandle, settings: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let path = app_data.join("settings.json");
    fs::write(path, settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_image_from_bytes(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    image_data: Vec<u8>,
) -> Result<Option<db::ImageRecord>, String> {
    let images_dir = get_images_dir(&app)?;
    let db_path = get_db_path(&app)?;

    // Save initial (fast)
    let record = tauri::async_runtime::spawn_blocking(move || {
        image_handler::add_from_bytes(&image_data, &images_dir, &db_path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(ref r) = record {
        // Queue thumbnail generation
        {
            let mut queue = state.job_queue.lock().map_err(|_| "Failed to lock queue")?;
            queue.push_back(ThumbnailJob {
                hash: r.hash.clone(),
                file_path: r.file_path.clone(),
            });
        }
    }

    Ok(record)
}

#[tauri::command]
async fn add_image_from_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<Option<db::ImageRecord>, String> {
    let images_dir = get_images_dir(&app)?;
    let db_path = get_db_path(&app)?;

    // Save initial (fast)
    let record = tauri::async_runtime::spawn_blocking(move || {
        image_handler::add_from_file(&file_path, &images_dir, &db_path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(ref r) = record {
        // Queue thumbnail generation
        {
            let mut queue = state.job_queue.lock().map_err(|_| "Failed to lock queue")?;
            queue.push_back(ThumbnailJob {
                hash: r.hash.clone(),
                file_path: r.file_path.clone(),
            });
        }
    }

    Ok(record)
}

#[tauri::command]
async fn add_image_from_url(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<Option<db::ImageRecord>, String> {
    // Download image bytes from the URL
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to download image from URL: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error {}: {}", response.status(), url));
    }
    
    // Check content type to make sure it's an image
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    
    if !content_type.starts_with("image/") && !content_type.is_empty() {
        // Some CDNs return application/octet-stream, so we won't reject those
        if content_type != "application/octet-stream" && !content_type.starts_with("binary/") {
            println!("Warning: URL content type is '{}', attempting to process anyway", content_type);
        }
    }
    
    let image_data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read image bytes: {}", e))?
        .to_vec();
    
    if image_data.is_empty() {
        return Err("Downloaded image is empty".to_string());
    }

    let images_dir = get_images_dir(&app)?;
    let db_path = get_db_path(&app)?;

    // Reuse save logic from add_image_from_bytes
    let record = tauri::async_runtime::spawn_blocking(move || {
        image_handler::add_from_bytes(&image_data, &images_dir, &db_path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(ref r) = record {
        // Queue thumbnail generation
        {
            let mut queue = state.job_queue.lock().map_err(|_| "Failed to lock queue")?;
            queue.push_back(ThumbnailJob {
                hash: r.hash.clone(),
                file_path: r.file_path.clone(),
            });
        }
    }

    Ok(record)
}

#[tauri::command]
async fn delete_image(app: tauri::AppHandle, hash: String) -> Result<(), String> {
    let images_dir = get_images_dir(&app)?;
    let db_path = get_db_path(&app)?;

    image_handler::delete_image(&hash, &images_dir, &db_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_image_path(app: tauri::AppHandle, hash: String) -> Result<String, String> {
    let images_dir = get_images_dir(&app)?;
    
    // New structure: images/<hash>/original.<ext>
    let image_folder = images_dir.join(&hash);
    
    if !image_folder.exists() {
        return Err("Image folder not found".to_string());
    }
    
    // Find the original file in the folder
    if let Ok(entries) = fs::read_dir(&image_folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    if name.to_string_lossy().starts_with("original.") {
                        return Ok(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    Err("Image not found".to_string())
}

fn get_images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let images_dir = app_data.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    Ok(images_dir)
}

fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    Ok(app_data.join("images.db"))
}

use std::sync::atomic::{AtomicBool, Ordering};

static IS_POLLING: AtomicBool = AtomicBool::new(false);
static CT_ENABLED: AtomicBool = AtomicBool::new(false);
static CT_LOGICAL_RECT: std::sync::Mutex<(f64, f64, f64, f64)> = std::sync::Mutex::new((0.0, 0.0, 0.0, 0.0));
static CURRENT_ALPHA_BYTE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(255);

#[tauri::command]
async fn set_click_through(window: tauri::Window, enabled: bool, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(mut rect) = CT_LOGICAL_RECT.lock() {
            *rect = (x, y, w, h);
        }
        CT_ENABLED.store(enabled, Ordering::Relaxed);
        
        if enabled && !IS_POLLING.swap(true, Ordering::Relaxed) {
             let window_clone = window.clone();
             std::thread::spawn(move || {
                 let mut currently_ignoring = false;
                 use std::time::Duration;
                 use windows::Win32::Foundation::POINT;
                 use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                 
                 loop {
                     std::thread::sleep(Duration::from_millis(50));
                     
                     if !CT_ENABLED.load(Ordering::Relaxed) {
                         if currently_ignoring {
                             let _ = window_clone.set_ignore_cursor_events(false);
                             currently_ignoring = false;
                         }
                         continue;
                     }
                     
                     let mut pt = POINT { x: 0, y: 0 };
                     unsafe { let _ = GetCursorPos(&mut pt); }
                     
                     if let (Ok(pos), Ok(scale)) = (window_clone.outer_position(), window_clone.scale_factor()) {
                         let (lx, ly, lw, lh) = *CT_LOGICAL_RECT.lock().unwrap();
                         let rx = pos.x + (lx * scale) as i32;
                         let ry = pos.y + (ly * scale) as i32;
                         let rw = (lw * scale) as i32;
                         let rh = (lh * scale) as i32;
                         
                         // We expand the rect slightly (10px) to make sure hover is caught robustly on edges
                         let in_rect = pt.x >= (rx - 10) && pt.x <= (rx + rw + 10) && pt.y >= (ry - 10) && pt.y <= (ry + rh + 10);
                         
                         if in_rect && currently_ignoring {
                             let _ = window_clone.set_ignore_cursor_events(false);
                             currently_ignoring = false;
                             if let Ok(hwnd) = window_clone.hwnd() {
                                 let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as _);
                                 unsafe {
                                     let exstyle = windows::Win32::UI::WindowsAndMessaging::GetWindowLongW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE);
                                     windows::Win32::UI::WindowsAndMessaging::SetWindowLongW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE, exstyle | windows::Win32::UI::WindowsAndMessaging::WS_EX_LAYERED.0 as i32);
                                     let _ = windows::Win32::UI::WindowsAndMessaging::SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), CURRENT_ALPHA_BYTE.load(Ordering::Relaxed), windows::Win32::UI::WindowsAndMessaging::LWA_ALPHA);
                                 }
                             }
                         } else if !in_rect && !currently_ignoring {
                             let _ = window_clone.set_ignore_cursor_events(true);
                             currently_ignoring = true;
                             if let Ok(hwnd) = window_clone.hwnd() {
                                 let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as _);
                                 unsafe {
                                     let exstyle = windows::Win32::UI::WindowsAndMessaging::GetWindowLongW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE);
                                     windows::Win32::UI::WindowsAndMessaging::SetWindowLongW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE, exstyle | windows::Win32::UI::WindowsAndMessaging::WS_EX_LAYERED.0 as i32);
                                     let _ = windows::Win32::UI::WindowsAndMessaging::SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), CURRENT_ALPHA_BYTE.load(Ordering::Relaxed), windows::Win32::UI::WindowsAndMessaging::LWA_ALPHA);
                                 }
                             }
                         }
                     }
                 }
             });
        }
        
        if !enabled {
            let _ = window.set_ignore_cursor_events(false);
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn toggle_always_on_top(window: tauri::Window, state: bool) -> Result<(), String> {
    window.set_always_on_top(state).map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_window_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_window_opacity(window: tauri::Window, alpha: f64, hide_ui: bool) -> Result<(), String> {
    let _ = window.set_decorations(!hide_ui);

    #[cfg(target_os = "windows")]
    {
        use std::thread;
        use std::time::Duration;
        // sleep a tiny bit to allow window to update its styles if necessary, before hooking layers again
        thread::sleep(Duration::from_millis(50));

        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetLayeredWindowAttributes, SetWindowLongW,
            GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0 as _);
            unsafe {
                let exstyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
                SetWindowLongW(hwnd, GWL_EXSTYLE, exstyle | WS_EX_LAYERED.0 as i32);
                let alpha_byte = (alpha.clamp(0.1, 1.0) * 255.0) as u8;
                CURRENT_ALPHA_BYTE.store(alpha_byte, Ordering::Relaxed);
                let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), alpha_byte, LWA_ALPHA);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Ignored on non-Windows platforms for this snippet
        let _ = alpha;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let job_queue = Arc::new(Mutex::new(VecDeque::new()));
    let queue_for_worker = job_queue.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_drag::init())
        .manage(AppState { job_queue })
        .setup(move |app| {
            // Initialize database
            let db_path = get_db_path(&app.handle())?;
            db::init_db(&db_path)?;
            
            // Start background worker with tokio-based rate limiting
            let app_handle = app.handle().clone();
            thread::spawn(move || {
                println!("Background thumbnail worker started (tokio rate-limited mode)");
                
                // Set lowest possible priority
                if let Err(e) = set_current_thread_priority(ThreadPriority::Min) {
                    eprintln!("Failed to set thread priority: {:?}", e);
                }

                // Create a single-threaded tokio runtime for this worker
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_time()
                    .build()
                    .expect("Failed to create tokio runtime");

                rt.block_on(async {
                    loop {
                        // Check if there are items in queue
                        let job = {
                            let mut q = queue_for_worker.lock().unwrap();
                            q.pop_front()
                        };
                        
                        if let Some(job) = job {
                            // Emit queue update
                            let remaining_in_queue = queue_for_worker.lock().unwrap().len();
                            let total_remaining = remaining_in_queue + 1;
                            let _ = app_handle.emit("queue-update", serde_json::json!({ 
                                "count": total_remaining
                            }));
                            
                            let images_dir = match get_images_dir(&app_handle) { Ok(p) => p, Err(_) => continue };
                            let db_path = match get_db_path(&app_handle) { Ok(p) => p, Err(_) => continue };

                            // Process with rate limiting using tokio
                            let hash_clone = job.hash.clone();
                            let app_handle_clone = app_handle.clone();
                            
                            match image_handler::generate_thumbnail_rate_limited(
                                job.hash.clone(), 
                                job.file_path, 
                                images_dir, 
                                db_path
                            ).await {
                                Ok(thumb_path) => {
                                     println!("Thumbnail generated for {}", hash_clone);
                                     let _ = app_handle_clone.emit("thumbnail-generated", serde_json::json!({
                                         "hash": hash_clone,
                                         "thumbnail_path": thumb_path
                                     }));
                                },
                                Err(e) => {
                                    eprintln!("Failed to generate thumbnail for {}: {}", hash_clone, e);
                                    let _ = app_handle_clone.emit("thumbnail-error", serde_json::json!({
                                        "hash": hash_clone,
                                        "error": e.to_string()
                                    }));
                                }
                            }
                            
                            // Small delay between images (reduced from 15s to 3s since we now have internal rate limiting)
                            async_sleep(Duration::from_secs(3)).await;
                        } else {
                            // Queue is empty, sleep longer
                            async_sleep(Duration::from_secs(5)).await;
                        }
                    }
                });
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_images,
            get_canvas_layout,
            save_canvas_layout,
            get_canvas_notes,
            save_canvas_notes,
            delete_canvas_note,
            get_canvas_drawings,
            save_canvas_drawings,
            get_app_settings,
            save_app_settings,
            add_image_from_bytes,
            add_image_from_file,
            add_image_from_url,
            delete_image,
            get_image_path,
            start_drag,
            open_in_explorer,
            open_url,
            toggle_always_on_top,
            set_window_opacity,
            set_click_through,
            start_window_drag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
