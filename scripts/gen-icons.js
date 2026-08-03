const sharp = require('sharp');
const path = require('path');

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="#059669"/>
  <g transform="translate(106,106) scale(0.6)" fill="white">
    <path d="M 0 50 L 0 350 L 100 350 L 100 200 L 200 200 L 200 350 L 300 350 L 300 50 L 0 50 Z" />
    <rect x="350" y="50" width="150" height="300" rx="20" />
    <circle cx="425" cy="150" r="20" fill="#059669" />
    <circle cx="425" cy="220" r="20" fill="#059669" />
    <circle cx="425" cy="290" r="20" fill="#059669" />
  </g>
  <text x="256" y="475" font-family="Arial, sans-serif" font-size="60" font-weight="bold" text-anchor="middle" fill="white">ComerciApp</text>
</svg>`;

(async () => {
  await sharp(Buffer.from(svgIcon)).resize(192, 192).png().toFile(path.join('/home/z/my-project/public', 'icon-192.png'));
  await sharp(Buffer.from(svgIcon)).resize(512, 512).png().toFile(path.join('/home/z/my-project/public', 'icon-512.png'));
  console.log('Icons generated');
})();
