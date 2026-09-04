'use strict';

const { PNG } = require('pngjs');
const {
	GLYPHS, GLYPH_WIDTH, GLYPH_HEIGHT, GLYPH_SPACING,
} = require('./mapFont');

/**
 * A tiny opaque RGBA raster canvas with just the primitives the map image needs. Homey apps
 * can't use node-canvas (native bindings), so tiles are composited and shapes rasterised here.
 */
class MapCanvas
{

	constructor(width, height, background)
	{
		this.width = width;
		this.height = height;
		this.data = Buffer.alloc(width * height * 4, 0xff);
		this.fill(background);
	}

	fill(colour)
	{
		for (let offset = 0; offset < this.data.length; offset += 4)
		{
			this.data[offset] = colour[0];
			this.data[offset + 1] = colour[1];
			this.data[offset + 2] = colour[2];
			this.data[offset + 3] = 0xff;
		}
	}

	blendPixel(x, y, colour, alpha = 1)
	{
		if (x < 0 || y < 0 || x >= this.width || y >= this.height)
		{
			return;
		}

		const offset = ((y * this.width) + x) * 4;
		if (alpha >= 1)
		{
			this.data[offset] = colour[0];
			this.data[offset + 1] = colour[1];
			this.data[offset + 2] = colour[2];
			return;
		}

		this.data[offset] += Math.round((colour[0] - this.data[offset]) * alpha);
		this.data[offset + 1] += Math.round((colour[1] - this.data[offset + 1]) * alpha);
		this.data[offset + 2] += Math.round((colour[2] - this.data[offset + 2]) * alpha);
	}

	fillRect(x, y, width, height, colour, alpha = 1)
	{
		const left = Math.max(0, Math.round(x));
		const top = Math.max(0, Math.round(y));
		const right = Math.min(this.width, Math.round(x + width));
		const bottom = Math.min(this.height, Math.round(y + height));

		for (let row = top; row < bottom; row++)
		{
			for (let column = left; column < right; column++)
			{
				this.blendPixel(column, row, colour, alpha);
			}
		}
	}

	fillCircle(centreX, centreY, radius, colour, alpha = 1)
	{
		const left = Math.max(0, Math.floor(centreX - radius - 1));
		const top = Math.max(0, Math.floor(centreY - radius - 1));
		const right = Math.min(this.width - 1, Math.ceil(centreX + radius + 1));
		const bottom = Math.min(this.height - 1, Math.ceil(centreY + radius + 1));

		for (let row = top; row <= bottom; row++)
		{
			for (let column = left; column <= right; column++)
			{
				const distance = Math.hypot((column + 0.5) - centreX, (row + 0.5) - centreY);
				// A one-pixel soft edge stands in for proper anti-aliasing.
				const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance));
				if (coverage > 0)
				{
					this.blendPixel(column, row, colour, coverage * alpha);
				}
			}
		}
	}

	/** Draws a polyline by stamping discs along it, which gives round caps and joins for free. */
	drawPolyline(points, thickness, colour)
	{
		const radius = thickness / 2;

		if (points.length === 1)
		{
			this.fillCircle(points[0].x, points[0].y, radius, colour);
			return;
		}

		for (let index = 1; index < points.length; index++)
		{
			const from = points[index - 1];
			const to = points[index];
			const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));

			for (let step = 0; step <= steps; step++)
			{
				const ratio = step / steps;
				this.fillCircle(from.x + ((to.x - from.x) * ratio), from.y + ((to.y - from.y) * ratio), radius, colour);
			}
		}
	}

	/** Copies a decoded RGBA tile into the canvas, clipped to the canvas bounds. */
	drawTile(tile, originX, originY)
	{
		const left = Math.max(0, -originX);
		const top = Math.max(0, -originY);
		const right = Math.min(tile.width, this.width - originX);
		const bottom = Math.min(tile.height, this.height - originY);

		for (let row = top; row < bottom; row++)
		{
			for (let column = left; column < right; column++)
			{
				const source = ((row * tile.width) + column) * 4;
				this.blendPixel(originX + column, originY + row, [
					tile.data[source],
					tile.data[source + 1],
					tile.data[source + 2],
				], tile.data[source + 3] / 255);
			}
		}
	}

	toPngBuffer()
	{
		const png = new PNG({ width: this.width, height: this.height });
		this.data.copy(png.data);
		// The canvas is fully opaque, so dropping the alpha channel shrinks the encoded image.
		return PNG.sync.write(png, { colorType: 2, inputHasAlpha: true });
	}

}

function measureText(text, scale)
{
	const characters = String(text).length;
	if (!characters)
	{
		return { width: 0, height: GLYPH_HEIGHT * scale };
	}

	return {
		width: ((characters * (GLYPH_WIDTH + GLYPH_SPACING)) - GLYPH_SPACING) * scale,
		height: GLYPH_HEIGHT * scale,
	};
}

function drawText(canvas, text, x, y, scale, colour)
{
	// The font has no accented glyphs, so "Adrián" is folded to "ADRIAN" rather than losing a letter.
	String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split('')
		.forEach((character, index) =>
		{
			const glyph = GLYPHS[character];
			if (!glyph)
			{
				return;
			}

			const glyphX = x + (index * (GLYPH_WIDTH + GLYPH_SPACING) * scale);
			for (let row = 0; row < GLYPH_HEIGHT; row++)
			{
				for (let column = 0; column < GLYPH_WIDTH; column++)
				{
					if (glyph[row][column] === '#')
					{
						canvas.fillRect(glyphX + (column * scale), y + (row * scale), scale, scale, colour);
					}
				}
			}
		});
}


module.exports = { MapCanvas, drawText, measureText };
