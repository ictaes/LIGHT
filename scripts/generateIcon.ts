import {createCanvas} from "canvas";
import * as fs from "fs";

const SIZE = 512;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d");

// Background: solid teal matching the LIGHT accent color
ctx.fillStyle = "#00C2CB";
ctx.fillRect(0, 0, SIZE, SIZE);

// A plain hexagon badge outline behind the monogram
const cx = SIZE / 2, cy = SIZE / 2, r = SIZE * 0.4;
ctx.beginPath();
for (let i = 0; i < 6; i++) {
	const angle = (Math.PI / 3) * i - Math.PI / 2;
	const x = cx + r * Math.cos(angle);
	const y = cy + r * Math.sin(angle);
	if (i === 0) ctx.moveTo(x, y);
	else ctx.lineTo(x, y);
}
ctx.closePath();
ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
ctx.lineWidth = SIZE * 0.025;
ctx.stroke();

// Bold "L" monogram, centered
ctx.fillStyle = "#FFFFFF";
ctx.font = `bold ${Math.floor(SIZE * 0.52)}px sans-serif`;
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText("L", SIZE / 2, SIZE / 2 + SIZE * 0.04);

const outPath = new URL("./icon.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
console.log(`Icon written to ${outPath} — review it, then run scripts/setAvatar.ts to upload.`);
