const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { protocol } = require('electron');

const LOCAL_PDF_PROTOCOL = 'paperquay-pdf';
const PDFJS_ASSET_PROTOCOL = 'paperquay-pdf-assets';

const PDFJS_ASSET_ROOT = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');
const PDFJS_ASSET_DIRS = new Set(['cmaps', 'standard_fonts', 'image_decoders']);

function registerLocalPdfProtocolScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_PDF_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
    {
      scheme: PDFJS_ASSET_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function createPlainResponse(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function createPdfStreamResponse(filePath, stat, request) {
  const fileSize = stat.size;
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-type': 'application/pdf',
  });
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    headers.set('content-length', String(fileSize));
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers,
    });
  }

  const rangeMatch = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!rangeMatch) {
    headers.set('content-range', `bytes */${fileSize}`);
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  let start = rangeMatch[1] ? Number(rangeMatch[1]) : NaN;
  let end = rangeMatch[2] ? Number(rangeMatch[2]) : NaN;

  if (!Number.isFinite(start) && Number.isFinite(end)) {
    start = Math.max(0, fileSize - end);
    end = fileSize - 1;
  } else {
    start = Number.isFinite(start) ? start : 0;
    end = Number.isFinite(end) ? end : fileSize - 1;
  }

  start = Math.max(0, Math.min(fileSize - 1, Math.trunc(start)));
  end = Math.max(start, Math.min(fileSize - 1, Math.trunc(end)));

  if (fileSize <= 0 || start >= fileSize) {
    headers.set('content-range', `bytes */${fileSize}`);
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  headers.set('content-length', String(end - start + 1));
  headers.set('content-range', `bytes ${start}-${end}/${fileSize}`);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 206,
      headers,
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
    status: 206,
    headers,
  });
}

async function handleLocalPdfRequest(request) {
  let requestUrl;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return createPlainResponse('Invalid PDF request URL.');
  }

  if (requestUrl.hostname !== 'local') {
    return createPlainResponse('Unknown PDF source.', 404);
  }

  const filePath = requestUrl.searchParams.get('path') || '';

  if (!filePath || path.extname(filePath).toLowerCase() !== '.pdf') {
    return createPlainResponse('Only PDF files can be served by this protocol.');
  }

  let stat;

  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      return createPlainResponse('PDF path is not a file.', 404);
    }
  } catch {
    return createPlainResponse('PDF file does not exist.', 404);
  }

  return createPdfStreamResponse(filePath, stat, request);
}

function createAssetResponse(filePath, stat) {
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(stat.size),
      'content-type': 'application/octet-stream',
    },
  });
}

async function handlePdfJsAssetRequest(request) {
  let requestUrl;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return createPlainResponse('Invalid PDF.js asset request URL.');
  }

  if (requestUrl.hostname !== 'pdfjs') {
    return createPlainResponse('Unknown PDF.js asset source.', 404);
  }

  const pathParts = decodeURIComponent(requestUrl.pathname)
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  const [assetDir, ...assetNameParts] = pathParts;

  if (!PDFJS_ASSET_DIRS.has(assetDir) || assetNameParts.length === 0) {
    return createPlainResponse('Unknown PDF.js asset.', 404);
  }

  const assetPath = path.resolve(PDFJS_ASSET_ROOT, assetDir, ...assetNameParts);
  const allowedRoot = path.resolve(PDFJS_ASSET_ROOT, assetDir);

  if (assetPath !== allowedRoot && !assetPath.startsWith(`${allowedRoot}${path.sep}`)) {
    return createPlainResponse('Illegal PDF.js asset path.', 400);
  }

  try {
    const stat = await fsp.stat(assetPath);
    if (!stat.isFile()) {
      return createPlainResponse('PDF.js asset path is not a file.', 404);
    }

    return createAssetResponse(assetPath, stat);
  } catch {
    return createPlainResponse('PDF.js asset does not exist.', 404);
  }
}

function registerLocalPdfProtocol() {
  protocol.handle(LOCAL_PDF_PROTOCOL, handleLocalPdfRequest);
  protocol.handle(PDFJS_ASSET_PROTOCOL, handlePdfJsAssetRequest);
}

module.exports = {
  LOCAL_PDF_PROTOCOL,
  PDFJS_ASSET_PROTOCOL,
  registerLocalPdfProtocol,
  registerLocalPdfProtocolScheme,
};
