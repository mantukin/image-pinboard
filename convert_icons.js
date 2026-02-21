const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceDir = path.join(__dirname, 'src-tauri/assets');
const outputDir = path.join(__dirname, 'src/assets/icons');

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const iconPipeline = {
  color_picker_icon: {
    mode: 'contain',
    width: 96,
    height: 96
  },
  pin_icon: {
    mode: 'height',
    height: 120
  },
  copy_to_clipboard_icon: {
    mode: 'height',
    height: 72
  },
  delete_icon: {
    mode: 'height',
    height: 72
  },
  edit_note_icon: {
    mode: 'height',
    height: 72
  },
  open_image_explorer_icon: {
    mode: 'height',
    height: 72
  }
};

function ensureOutputDir() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function buildTransformer(inputPath, spec) {
  let transformer = sharp(inputPath).trim();

  if (spec.mode === 'contain') {
    transformer = transformer.resize(spec.width, spec.height, {
      fit: 'contain',
      background: TRANSPARENT,
      kernel: sharp.kernel.lanczos3
    });
  } else if (spec.mode === 'height') {
    transformer = transformer.resize({
      height: spec.height,
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    });
  } else {
    throw new Error(`Unsupported resize mode: ${spec.mode}`);
  }

  return transformer.webp({
    lossless: true,
    effort: 6
  });
}

async function convertIcon(fileName, spec) {
  const inputPath = path.join(sourceDir, fileName);
  const outputPath = path.join(outputDir, `${path.parse(fileName).name}.webp`);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Source file not found: ${inputPath}`);
  }

  const sourceMeta = await sharp(inputPath).metadata();
  await buildTransformer(inputPath, spec).toFile(outputPath);
  const outputMeta = await sharp(outputPath).metadata();

  console.log(
    `${fileName}: ${sourceMeta.width}x${sourceMeta.height} -> ${outputMeta.width}x${outputMeta.height}`
  );
}

async function convertIcons() {
  ensureOutputDir();
  console.log('Starting unified icon conversion pipeline...');

  const iconEntries = Object.entries(iconPipeline).map(([name, spec]) => [`${name}.png`, spec]);

  for (const [fileName, spec] of iconEntries) {
    try {
      await convertIcon(fileName, spec);
    } catch (error) {
      console.error(`Failed to convert ${fileName}:`, error.message);
      process.exitCode = 1;
    }
  }
}

convertIcons();
