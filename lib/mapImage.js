'use strict';

const { PNG } = require('pngjs');
const { MapCanvas, drawText, measureText } = require('./mapCanvas');
const { distanceMeters } = require('./geo');

const TILE_SIZE = 256;
const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// OpenStreetMap's tile usage policy requires an identifying User-Agent.
const TILE_USER_AGENT = 'HomeyTracks/1.0 (Homey app; https://github.com/AdyRock/com.ady.homeytrack)';
const TILE_TIMEOUT_MS = 8000;
const TILE_CACHE_LIMIT = 64;
const TILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Homey shows a device's picture in a square frame, so anything else gets letterboxed.
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 600;
const EDGE_PADDING = 72;
const MIN_ZOOM = 2;
const MAX_ZOOM = 17;
const SINGLE_POINT_ZOOM = 16;
const MAX_JOURNEY_POINTS = 400;
const LABEL_SCALE = 4;
const ATTRIBUTION_SCALE = 2;
const MARKER_RADIUS = 17;
const KM_TO_MILES = 0.621371;

const COLOUR_BACKGROUND = [232, 228, 220];
const COLOUR_TRACK = [24, 116, 235];
const COLOUR_TRACK_HALO = [255, 255, 255];
const COLOUR_CURRENT = [225, 58, 58];
const COLOUR_START = [40, 160, 80];
const COLOUR_ACCURACY = [24, 116, 235];
const COLOUR_WHITE = [255, 255, 255];
const COLOUR_BLACK = [0, 0, 0];

// Raw tile bytes are cached rather than decoded pixels; a decoded tile is 256 KB and Homey
// apps run under a tight memory budget.
const tileCache = new Map();

function lonToWorldX(lon, zoom)
{
	return ((lon + 180) / 360) * TILE_SIZE * (2 ** zoom);
}

function latToWorldY(lat, zoom)
{
	const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
	const sin = Math.sin((clamped * Math.PI) / 180);
	return (0.5 - (Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))) * TILE_SIZE * (2 ** zoom);
}

async function fetchTile(zoom, tileX, tileY)
{
	const tileCount = 2 ** zoom;
	if (tileY < 0 || tileY >= tileCount)
	{
		return null;
	}

	const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
	const key = `${zoom}/${wrappedX}/${tileY}`;
	const cached = tileCache.get(key);
	if (cached && cached.expires > Date.now())
	{
		// Re-insert to keep the Map ordered least-recently-used first.
		tileCache.delete(key);
		tileCache.set(key, cached);
		return PNG.sync.read(cached.buffer);
	}

	const url = TILE_URL_TEMPLATE
		.replace('{z}', String(zoom))
		.replace('{x}', String(wrappedX))
		.replace('{y}', String(tileY));
	const response = await fetch(url, {
		headers: { 'User-Agent': TILE_USER_AGENT, Accept: 'image/png' },
		signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
	});
	if (!response.ok)
	{
		throw new Error(`Map tile ${key} request failed (${response.status})`);
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	tileCache.set(key, { buffer, expires: Date.now() + TILE_CACHE_TTL_MS });
	while (tileCache.size > TILE_CACHE_LIMIT)
	{
		tileCache.delete(tileCache.keys().next().value);
	}

	return PNG.sync.read(buffer);
}

async function drawTiles(canvas, zoom, originX, originY, onError)
{
	const firstTileX = Math.floor(originX / TILE_SIZE);
	const lastTileX = Math.floor((originX + canvas.width - 1) / TILE_SIZE);
	const firstTileY = Math.floor(originY / TILE_SIZE);
	const lastTileY = Math.floor((originY + canvas.height - 1) / TILE_SIZE);
	const requests = [];

	for (let tileY = firstTileY; tileY <= lastTileY; tileY++)
	{
		for (let tileX = firstTileX; tileX <= lastTileX; tileX++)
		{
			requests.push(
				fetchTile(zoom, tileX, tileY)
					.then((tile) =>
					{
						if (tile)
						{
							canvas.drawTile(tile, Math.round((tileX * TILE_SIZE) - originX), Math.round((tileY * TILE_SIZE) - originY));
						}
					})
					// A missing tile just leaves the background showing; it must not fail the image.
					.catch((err) => onError && onError(err))
			);
		}
	}

	await Promise.all(requests);
}

/**
 * Splits a track into journeys, newest first. A journey is a run of points no further apart in
 * time than the journey gap; lone points aren't a trip and are dropped.
 * @param {object[]} track
 * @param {number} gapMilliseconds
 * @returns {{ start: number, end: number, points: object[] }[]}
 */
function buildJourneys(track, gapMilliseconds)
{
	const points = (Array.isArray(track) ? track : [])
		.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.timestamp))
		.sort((first, second) => first.timestamp - second.timestamp);
	const journeys = [];

	points.forEach((point) =>
	{
		const current = journeys[journeys.length - 1];
		if (!current || point.timestamp - current.end > gapMilliseconds)
		{
			journeys.push({ start: point.timestamp, end: point.timestamp, points: [point] });
		} else
		{
			current.end = point.timestamp;
			current.points.push(point);
		}
	});

	return journeys
		.filter((journey) => journey.points.length > 1)
		.map((journey) => ({ ...journey, points: journey.points.slice(-MAX_JOURNEY_POINTS) }))
		.reverse();
}

function formatDistance(points, useMiles)
{
	let metres = 0;
	for (let index = 1; index < points.length; index++)
	{
		metres += distanceMeters(points[index - 1].lat, points[index - 1].lon, points[index].lat, points[index].lon);
	}

	const distance = useMiles ? (metres / 1000) * KM_TO_MILES : metres / 1000;
	return `${distance.toFixed(1)} ${useMiles ? 'mi' : 'km'}`;
}

function formatDuration(milliseconds)
{
	const minutes = Math.max(0, Math.round(milliseconds / 60000));
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function pickZoom(points, width, height)
{
	const latitudes = points.map((point) => point.lat);
	const longitudes = points.map((point) => point.lon);
	const minLat = Math.min(...latitudes);
	const maxLat = Math.max(...latitudes);
	const minLon = Math.min(...longitudes);
	const maxLon = Math.max(...longitudes);
	const usableWidth = Math.max(1, width - (EDGE_PADDING * 2));
	const usableHeight = Math.max(1, height - (EDGE_PADDING * 2));

	for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--)
	{
		const spanX = lonToWorldX(maxLon, zoom) - lonToWorldX(minLon, zoom);
		const spanY = latToWorldY(minLat, zoom) - latToWorldY(maxLat, zoom);
		if (spanX <= usableWidth && spanY <= usableHeight)
		{
			return zoom;
		}
	}

	return MIN_ZOOM;
}

function drawLabel(canvas, text)
{
	if (!text)
	{
		return;
	}

	const size = measureText(text, LABEL_SCALE);
	canvas.fillRect(14, 14, size.width + 24, size.height + 20, COLOUR_BLACK, 0.55);
	drawText(canvas, text, 26, 24, LABEL_SCALE, COLOUR_WHITE);
}

function drawAttribution(canvas)
{
	const text = '© OpenStreetMap';
	const size = measureText(text, ATTRIBUTION_SCALE);
	canvas.fillRect(canvas.width - size.width - 14, canvas.height - size.height - 12, size.width + 14, size.height + 12, COLOUR_WHITE, 0.7);
	drawText(canvas, text, canvas.width - size.width - 7, canvas.height - size.height - 6, ATTRIBUTION_SCALE, [70, 70, 70]);
}

function drawMarker(canvas, x, y, colour)
{
	canvas.fillCircle(x, y, MARKER_RADIUS, COLOUR_WHITE);
	canvas.fillCircle(x, y, MARKER_RADIUS - 3, colour);
	canvas.fillCircle(x, y, MARKER_RADIUS - 11, COLOUR_WHITE);
}

/**
 * Draws everything that both image types share: tiles, the route (when there is more than one
 * point), an accuracy halo, the start/end markers, the label and the attribution.
 * @param {MapCanvas} canvas
 * @param {{ path: object[], accuracy?: number, label?: string, onError?: Function }} scene
 */
async function drawScene(canvas, scene)
{
	const { path } = scene;
	const zoom = path.length > 1 ? pickZoom(path, canvas.width, canvas.height) : SINGLE_POINT_ZOOM;
	const worldX = path.map((point) => lonToWorldX(point.lon, zoom));
	const worldY = path.map((point) => latToWorldY(point.lat, zoom));
	const originX = ((Math.min(...worldX) + Math.max(...worldX)) / 2) - (canvas.width / 2);
	const originY = ((Math.min(...worldY) + Math.max(...worldY)) / 2) - (canvas.height / 2);
	const projected = path.map((point, index) => ({ x: worldX[index] - originX, y: worldY[index] - originY }));
	const last = projected[projected.length - 1];

	await drawTiles(canvas, zoom, originX, originY, scene.onError);

	if (projected.length > 1)
	{
		canvas.drawPolyline(projected, 15, COLOUR_TRACK_HALO);
		canvas.drawPolyline(projected, 9, COLOUR_TRACK);
	}

	if (Number.isFinite(scene.accuracy) && scene.accuracy > 0)
	{
		// Web Mercator metres-per-pixel, corrected for latitude.
		const metresPerPixel = (156543.03392 * Math.cos((path[path.length - 1].lat * Math.PI) / 180)) / (2 ** zoom);
		const radius = scene.accuracy / metresPerPixel;
		if (radius > MARKER_RADIUS && radius < Math.max(canvas.width, canvas.height))
		{
			canvas.fillCircle(last.x, last.y, radius, COLOUR_ACCURACY, 0.15);
		}
	}

	if (projected.length > 1)
	{
		drawMarker(canvas, projected[0].x, projected[0].y, COLOUR_START);
	}
	drawMarker(canvas, last.x, last.y, COLOUR_CURRENT);

	drawLabel(canvas, scene.label);
	drawAttribution(canvas);
}

function createCanvas(options)
{
	return new MapCanvas(options.width || DEFAULT_WIDTH, options.height || DEFAULT_HEIGHT, COLOUR_BACKGROUND);
}

/**
 * Renders a PNG map for one user: the journey they are currently on when there is one, or just
 * their last known position. Tile failures degrade to a plain background rather than throwing.
 * @param {object} options
 * @param {{ lat: number, lon: number, accuracy?: number }|null} options.location Last known location.
 * @param {object[]} options.track Recorded track points.
 * @param {number} [options.journeyGapMinutes] Idle gap that ends a journey.
 * @param {string} [options.zone] Current zone, labelled when the user isn't moving.
 * @param {number} [options.speed] Current speed, labelled instead of the zone while travelling.
 * @param {boolean} [options.useMiles] Label the speed in mph rather than km/h.
 * @param {string} [options.placeholderText] Shown when there is no known position.
 * @param {(err: Error) => void} [options.onError]
 * @returns {Promise<Buffer>} PNG image data.
 */
async function renderUserMapImage(options)
{
	const canvas = createCanvas(options);
	const gapMilliseconds = (Number(options.journeyGapMinutes) || 30) * 60 * 1000;
	const journey = buildJourneys(options.track, gapMilliseconds)[0] || null;
	const newest = journey ? journey.points[journey.points.length - 1] : null;
	const reported = options.location && Number.isFinite(options.location.lat) && Number.isFinite(options.location.lon)
		? options.location
		: newest;

	if (!reported)
	{
		drawLabel(canvas, options.placeholderText || 'No location yet');
		drawAttribution(canvas);
		return canvas.toPngBuffer();
	}

	const current = { lat: reported.lat, lon: reported.lon };
	const inProgress = journey !== null && (Date.now() - journey.end) <= gapMilliseconds;
	const isNewPosition = !newest || newest.lat !== current.lat || newest.lon !== current.lon;
	const speed = Number(options.speed);

	await drawScene(canvas, {
		path: inProgress ? [...journey.points, ...(isNewPosition ? [current] : [])] : [current],
		accuracy: Number(reported.accuracy),
		label: Number.isFinite(speed) && speed > 0
			? `${Math.round(speed)} ${options.useMiles ? 'mph' : 'km/h'}`
			: options.zone,
		onError: options.onError,
	});

	return canvas.toPngBuffer();
}

/**
 * Renders one journey: its whole route with the start and end marked, labelled with the distance
 * covered and how long it took.
 * @param {object} options
 * @param {{ start: number, end: number, points: object[] }|undefined} options.journey
 * @param {boolean} [options.useMiles] Label the distance in miles rather than kilometres.
 * @param {string} [options.placeholderText] Shown when the journey no longer exists.
 * @param {(err: Error) => void} [options.onError]
 * @returns {Promise<Buffer>} PNG image data.
 */
async function renderJourneyMapImage(options)
{
	const canvas = createCanvas(options);
	const journey = options.journey;

	if (!journey || journey.points.length < 2)
	{
		drawLabel(canvas, options.placeholderText || 'No journey');
		drawAttribution(canvas);
		return canvas.toPngBuffer();
	}

	await drawScene(canvas, {
		path: journey.points,
		label: `${formatDistance(journey.points, Boolean(options.useMiles))} / ${formatDuration(journey.end - journey.start)}`,
		onError: options.onError,
	});

	return canvas.toPngBuffer();
}

module.exports = { renderUserMapImage, renderJourneyMapImage, buildJourneys };
