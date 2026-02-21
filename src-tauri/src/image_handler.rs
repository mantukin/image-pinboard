use image::{DynamicImage, ImageFormat};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep as async_sleep;

use crate::db::{self, ImageRecord};

const THUMBNAIL_SIZE: u32 = 200;
const MAX_DECODE_SIZE: u32 = 2048; // Limit decode size to reduce CPU load

// Special constant to indicate thumbnail is pending
pub const PENDING_THUMBNAIL: &str = "PENDING";

pub fn add_from_file(
    file_path: &str,
    images_dir: &Path,
    db_path: &Path,
) -> Result<Option<ImageRecord>, Box<dyn std::error::Error>> {
    let img_data = fs::read(file_path)?;
    save_initial(&img_data, images_dir, db_path)
}

pub fn add_from_bytes(
    img_data: &[u8],
    images_dir: &Path,
    db_path: &Path,
) -> Result<Option<ImageRecord>, Box<dyn std::error::Error>> {
    save_initial(img_data, images_dir, db_path)
}

fn save_initial(
    img_data: &[u8],
    images_dir: &Path,
    db_path: &Path,
) -> Result<Option<ImageRecord>, Box<dyn std::error::Error>> {
    let hash = calculate_hash(img_data);

    if db::image_exists(db_path, &hash)? {
        return Ok(None);
    }

    // Try to guess format
    let format = image::guess_format(img_data).unwrap_or(ImageFormat::Png);
    let ext = format.extensions_str().first().unwrap_or(&"png");

    // Create folder structure: images/<hash>/
    let image_folder = images_dir.join(&hash);
    fs::create_dir_all(&image_folder)?;
    
    // Save original in its own folder
    let full_filename = format!("original.{}", ext);
    let full_path = image_folder.join(&full_filename);

    // Write raw bytes directly
    fs::write(&full_path, img_data)?;

    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;

    // Set thumbnail path to PENDING
    let record = ImageRecord {
        hash,
        timestamp,
        file_path: full_path.to_string_lossy().to_string(),
        thumbnail_path: PENDING_THUMBNAIL.to_string(),
    };

    db::add_image(db_path, &record)?;

    Ok(Some(record))
}

// Async version with tokio-based rate limiting
pub async fn generate_thumbnail_rate_limited(
    hash: String,
    file_path: String,
    images_dir: PathBuf,
    db_path: PathBuf,
) -> Result<String, Box<dyn std::error::Error>> {
    // Initial delay to avoid immediate CPU spike
    async_sleep(Duration::from_millis(500)).await;
    
    // Step 1: Read file (I/O bound, use spawn_blocking)
    let file_path_clone = file_path.clone();
    let img_data = tokio::task::spawn_blocking(move || {
        fs::read(&file_path_clone).map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Join error: {}", e))??;
    
    // Cooldown after I/O
    async_sleep(Duration::from_millis(500)).await;
    
    // Step 2: Decode image (CPU intensive, use spawn_blocking)
    let img = tokio::task::spawn_blocking(move || {
        image::load_from_memory(&img_data).map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Join error: {}", e))??;
    
    // Longer cooldown after decode (most CPU intensive)
    async_sleep(Duration::from_secs(2)).await;
    
    // Step 3: Pre-resize if needed (CPU intensive)
    let img_to_resize = if img.width() > MAX_DECODE_SIZE || img.height() > MAX_DECODE_SIZE {
        let intermediate = tokio::task::spawn_blocking(move || {
            Ok::<DynamicImage, String>(img.resize(MAX_DECODE_SIZE, MAX_DECODE_SIZE, image::imageops::FilterType::Nearest))
        }).await.map_err(|e| format!("Join error: {}", e))??;
        
        // Cooldown after intermediate resize
        async_sleep(Duration::from_secs(1)).await;
        intermediate
    } else {
        img
    };
    
    // Create thumbnails subfolder: images/<hash>/thumbnails/
    let image_folder = images_dir.join(&hash);
    let thumbnails_folder = image_folder.join("thumbnails");
    tokio::task::spawn_blocking(move || {
        fs::create_dir_all(&thumbnails_folder).map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Join error: {}", e))??;
    
    let thumbnail_filename = "thumb.webp";
    let thumbnail_path = images_dir.join(&hash).join("thumbnails").join(thumbnail_filename);
    let thumbnail_path_clone = thumbnail_path.clone();
    
    // Step 4: Generate final thumbnail (CPU intensive)
    tokio::task::spawn_blocking(move || {
        generate_thumbnail_fast(&img_to_resize, &thumbnail_path_clone)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Join error: {}", e))??;
    
    // Cooldown after final resize
    async_sleep(Duration::from_millis(500)).await;
    
    let thumb_str = thumbnail_path.to_string_lossy().to_string();
    
    // Step 5: Update DB (I/O bound)
    let db_path_clone = db_path.clone();
    let hash_clone = hash.clone();
    let thumb_str_clone = thumb_str.clone();
    tokio::task::spawn_blocking(move || {
        db::update_thumbnail_path(&db_path_clone, &hash_clone, &thumb_str_clone)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Join error: {}", e))??;
    
    Ok(thumb_str)
}

pub fn delete_image(
    hash: &str,
    images_dir: &Path,
    db_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // Delete entire folder for this image: images/<hash>/
    let image_folder = images_dir.join(hash);
    if image_folder.exists() {
        fs::remove_dir_all(image_folder)?;
    }

    // Delete from database
    db::delete_image(db_path, hash)?;

    Ok(())
}

fn calculate_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

fn generate_thumbnail_fast(
    img: &DynamicImage,
    output_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // Use Nearest filter for fastest resizing (lower quality but much faster)
    let thumbnail = img.resize(
        THUMBNAIL_SIZE,
        THUMBNAIL_SIZE,
        image::imageops::FilterType::Nearest,
    );
    thumbnail.save_with_format(output_path, ImageFormat::WebP)?;
    Ok(())
}
