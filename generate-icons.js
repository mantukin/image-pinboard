const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
    const inputPath = path.join(__dirname, 'src-tauri', 'icons', '128x128.png');
    const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

    // Read the input image
    const image = sharp(inputPath);
    const metadata = await image.metadata();

    console.log(`Original size: ${metadata.width}x${metadata.height}`);

    // Make it square by adding transparent padding
    const size = Math.max(metadata.width, metadata.height);
    const squareImage = await sharp(inputPath)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

    // Save square icon
    const squarePath = path.join(iconsDir, 'icon.png');
    await sharp(squareImage).toFile(squarePath);
    console.log(`Created square icon: ${squarePath}`);

    // Generate ICO for Windows (multiple sizes in one file)
    // Note: sharp doesn't support ICO directly, so we'll create a simple placeholder
    // For production, use proper icon generation tools

    // For now, just create a simple 256x256 PNG that can be used
    await sharp(squareImage)
        .resize(256, 256)
        .toFile(path.join(iconsDir, 'icon-256.png'));

    console.log('Icons generated successfully!');
    console.log('Note: For production, use proper icon generation tools like:');
    console.log('  npx @tauri-apps/cli icon src-tauri/icons/icon.png');
}

generateIcons().catch(console.error);
