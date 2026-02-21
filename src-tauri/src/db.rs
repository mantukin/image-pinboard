use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageRecord {
    pub hash: String,
    pub timestamp: i64,
    pub file_path: String,
    pub thumbnail_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CanvasLayoutRecord {
    pub hash: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub width: f64,
    pub height: f64,
    pub z_index: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CanvasNoteRecord {
    pub id: String,
    pub text: String,
    pub color: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_index: i64,
    pub updated_at: i64,
}

pub fn init_db(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS images (
            hash TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            thumbnail_path TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_timestamp ON images(timestamp DESC)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS canvas_layout (
            hash TEXT PRIMARY KEY,
            x REAL NOT NULL,
            y REAL NOT NULL,
            scale REAL NOT NULL,
            width REAL NOT NULL DEFAULT 220,
            height REAL NOT NULL DEFAULT 220,
            z_index INTEGER NOT NULL,
            FOREIGN KEY(hash) REFERENCES images(hash) ON DELETE CASCADE
        )",
        [],
    )?;

    // Backward-compatible migration for existing databases created before width/height fields.
    ensure_canvas_layout_column(&conn, "width", "REAL NOT NULL DEFAULT 220")?;
    ensure_canvas_layout_column(&conn, "height", "REAL NOT NULL DEFAULT 220")?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_canvas_z ON canvas_layout(z_index DESC)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS canvas_notes (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '#fef08a',
            x REAL NOT NULL,
            y REAL NOT NULL,
            width REAL NOT NULL DEFAULT 240,
            height REAL NOT NULL DEFAULT 240,
            z_index INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Backward-compatible migration for notes table fields.
    ensure_canvas_notes_column(&conn, "text", "TEXT NOT NULL DEFAULT ''")?;
    ensure_canvas_notes_column(&conn, "color", "TEXT NOT NULL DEFAULT '#fef08a'")?;
    ensure_canvas_notes_column(&conn, "width", "REAL NOT NULL DEFAULT 240")?;
    ensure_canvas_notes_column(&conn, "height", "REAL NOT NULL DEFAULT 240")?;
    ensure_canvas_notes_column(&conn, "updated_at", "INTEGER NOT NULL DEFAULT 0")?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_canvas_notes_z ON canvas_notes(z_index DESC)",
        [],
    )?;

    Ok(())
}

pub fn add_image(db_path: &Path, record: &ImageRecord) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT OR IGNORE INTO images (hash, timestamp, file_path, thumbnail_path)
         VALUES (?1, ?2, ?3, ?4)",
        [
            &record.hash,
            &record.timestamp.to_string(),
            &record.file_path,
            &record.thumbnail_path,
        ],
    )?;

    Ok(())
}

pub fn get_images_paged(db_path: &Path, limit: i32, offset: i32) -> Result<Vec<ImageRecord>> {
    let conn = Connection::open(db_path)?;

    let mut stmt = conn.prepare(
        "SELECT hash, timestamp, file_path, thumbnail_path
         FROM images
         ORDER BY timestamp DESC
         LIMIT ?1 OFFSET ?2",
    )?;

    let records = stmt.query_map([limit, offset], |row| {
        Ok(ImageRecord {
            hash: row.get(0)?,
            timestamp: row.get(1)?,
            file_path: row.get(2)?,
            thumbnail_path: row.get(3)?,
        })
    })?;

    let mut result = Vec::new();
    for record in records {
        result.push(record?);
    }

    Ok(result)
}

pub fn image_exists(db_path: &Path, hash: &str) -> Result<bool> {
    let conn = Connection::open(db_path)?;

    let mut stmt = conn.prepare("SELECT COUNT(*) FROM images WHERE hash = ?1")?;
    let count: i32 = stmt.query_row([hash], |row| row.get(0))?;

    Ok(count > 0)
}

pub fn update_thumbnail_path(db_path: &Path, hash: &str, thumbnail_path: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "UPDATE images SET thumbnail_path = ?1 WHERE hash = ?2",
        [thumbnail_path, hash],
    )?;
    Ok(())
}

pub fn delete_image(db_path: &Path, hash: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute("DELETE FROM images WHERE hash = ?1", [hash])?;
    conn.execute("DELETE FROM canvas_layout WHERE hash = ?1", [hash])?;

    Ok(())
}

pub fn get_canvas_layout(db_path: &Path) -> Result<Vec<CanvasLayoutRecord>> {
    let conn = Connection::open(db_path)?;

    let mut stmt = conn.prepare(
        "SELECT hash, x, y, scale, width, height, z_index
         FROM canvas_layout
         ORDER BY z_index ASC",
    )?;

    let records = stmt.query_map([], |row| {
        Ok(CanvasLayoutRecord {
            hash: row.get(0)?,
            x: row.get(1)?,
            y: row.get(2)?,
            scale: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            z_index: row.get(6)?,
        })
    })?;

    let mut result = Vec::new();
    for record in records {
        result.push(record?);
    }
    Ok(result)
}

pub fn upsert_canvas_item(
    db_path: &Path,
    hash: &str,
    x: f64,
    y: f64,
    scale: f64,
    width: f64,
    height: f64,
    z_index: i64,
) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT INTO canvas_layout (hash, x, y, scale, width, height, z_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(hash) DO UPDATE SET
           x = excluded.x,
           y = excluded.y,
           scale = excluded.scale,
           width = excluded.width,
           height = excluded.height,
           z_index = excluded.z_index",
        rusqlite::params![hash, x, y, scale, width, height, z_index],
    )?;

    Ok(())
}

pub fn get_canvas_notes(db_path: &Path) -> Result<Vec<CanvasNoteRecord>> {
    let conn = Connection::open(db_path)?;

    let mut stmt = conn.prepare(
        "SELECT id, text, color, x, y, width, height, z_index, updated_at
         FROM canvas_notes
         ORDER BY z_index ASC",
    )?;

    let records = stmt.query_map([], |row| {
        Ok(CanvasNoteRecord {
            id: row.get(0)?,
            text: row.get(1)?,
            color: row.get(2)?,
            x: row.get(3)?,
            y: row.get(4)?,
            width: row.get(5)?,
            height: row.get(6)?,
            z_index: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    let mut result = Vec::new();
    for record in records {
        result.push(record?);
    }

    Ok(result)
}

pub fn upsert_canvas_note(
    db_path: &Path,
    id: &str,
    text: &str,
    color: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: i64,
    updated_at: i64,
) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT INTO canvas_notes (id, text, color, x, y, width, height, z_index, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           color = excluded.color,
           x = excluded.x,
           y = excluded.y,
           width = excluded.width,
           height = excluded.height,
           z_index = excluded.z_index,
           updated_at = excluded.updated_at",
        rusqlite::params![id, text, color, x, y, width, height, z_index, updated_at],
    )?;

    Ok(())
}

pub fn delete_canvas_note(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM canvas_notes WHERE id = ?1", [id])?;
    Ok(())
}

fn ensure_canvas_layout_column(conn: &Connection, column_name: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(canvas_layout)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;

    let mut exists = false;
    for col in columns {
        if col? == column_name {
            exists = true;
            break;
        }
    }

    if !exists {
        let sql = format!("ALTER TABLE canvas_layout ADD COLUMN {} {}", column_name, definition);
        conn.execute(&sql, [])?;
    }

    Ok(())
}

fn ensure_canvas_notes_column(conn: &Connection, column_name: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(canvas_notes)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;

    let mut exists = false;
    for col in columns {
        if col? == column_name {
            exists = true;
            break;
        }
    }

    if !exists {
        let sql = format!("ALTER TABLE canvas_notes ADD COLUMN {} {}", column_name, definition);
        conn.execute(&sql, [])?;
    }

    Ok(())
}
