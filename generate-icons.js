import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const svgPath = path.join(process.cwd(), 'static', 'icons', 'icon.svg');
const out192 = path.join(process.cwd(), 'static', 'icons', 'icon-192.png');
const out512 = path.join(process.cwd(), 'static', 'icons', 'icon-512.png');

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);

  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(out192);

  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(out512);

  console.log('Successfully generated PNG icons: icon-192.png and icon-512.png');
}

generateIcons().catch(err => {
  console.error('Error generating PNG icons:', err);
  process.exit(1);
});
