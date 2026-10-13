#!/usr/bin/env node
// Generates the static, SEO-ready pages from src/template.html.
//
//   node scripts/build.mjs
//
// Writes index.html, one folder per landing page (e.g. /crop-image/index.html),
// 404.html and sitemap.xml. Each page shares the same app but has its own
// title, description, canonical URL, H1, structured data, guide content and
// starting configuration (passed to app.js via <body data-config>).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://iloveimages.webappslab.com';
const BRAND = 'iLoveImages';
const OG_IMAGE = `${SITE}/og-image.png`;
const TODAY = new Date().toISOString().slice(0, 10);

// Mirrors BUILTIN_VIEWPORTS in app.js (used for the sizes table).
const SIZES = [
  ['Desktop', '1920 × 1080', 'Full HD screens, hero banners, wallpapers'],
  ['Laptop', '1366 × 768', 'Common laptop screens'],
  ['Tablet', '768 × 1024', 'iPad and tablets in portrait'],
  ['Mobile', '390 × 844', 'Modern phone screens'],
  ['Instagram post', '1080 × 1080', 'Square feed posts (1:1)'],
  ['Instagram portrait', '1080 × 1350', 'Portrait feed posts (4:5)'],
  ['Story / Reel', '1080 × 1920', 'Instagram, Facebook and WhatsApp stories, Reels, Shorts, TikTok (9:16)'],
  ['Link preview', '1200 × 630', 'Open Graph images for Facebook, LinkedIn, X and Slack'],
  ['YouTube thumbnail', '1280 × 720', 'Video thumbnails (16:9)'],
  ['Thumbnail', '300 × 300', 'Product grids and avatars'],
  ['App icon', '512 × 512', 'PWA and store icons'],
];

const SHARED_FAQ = [
  ['Is iLoveImages free?', 'Yes. Every feature is free with no sign-up, no watermark and no limit on the number of images.'],
  ['Are my images uploaded to a server?', 'No. Cropping, editing, resizing and compression all happen on your device using your browser. Your photos never leave your computer or phone, so the tool is private and works even on slow connections once the page has loaded.'],
  ['Which image formats are supported?', 'You can open JPG, PNG, WebP, GIF, BMP, AVIF and HEIC (where your browser supports it). You can export to JPEG, WebP and PNG, and to AVIF in browsers that can encode it.'],
  ['How do I make an image smaller in KB?', 'Switch Compression to "Target size" and enter the maximum file size in KB. The tool finds the highest quality that fits under your limit for every size, and can shrink the dimensions if quality alone is not enough.'],
  ['Can I resize one image to many sizes at once?', 'Yes. Turn on any built-in viewports (desktop, tablet, mobile, Instagram, YouTube and more) or add your own width and height, then download each file or all of them as a ZIP.'],
  ['Will resizing reduce image quality?', 'Downscaling uses multi-step, high-quality resampling to keep edges sharp, and the "Never upscale" option stops small images from being stretched and blurred. You can inspect every output at 100% before downloading.'],
];

const TOOLS = [
  { slug: 'resize-image-for-instagram', label: 'Resize image for Instagram' },
  { slug: 'resize-image-for-youtube-thumbnail', label: 'YouTube thumbnail resizer' },
  { slug: 'compress-image-to-100kb', label: 'Compress image to 100 KB' },
  { slug: 'compress-image-to-50kb', label: 'Compress image to 50 KB' },
  { slug: 'crop-image', label: 'Crop image online' },
  { slug: 'convert-image-to-webp', label: 'Convert image to WebP' },
  { slug: 'responsive-image-generator', label: 'Responsive image generator' },
];

const PAGES = [
  {
    slug: '',
    title: 'Free Image Resizer, Cropper & Compressor Online | iLoveImages',
    description: 'Resize, crop and compress images for desktop, mobile, Instagram, YouTube and more in one go. Free, fast and private: everything runs in your browser.',
    h1: 'Free image resizer, cropper & compressor',
    appName: 'iLoveImages: image resizer, cropper and compressor',
    intro: [
      'iLoveImages is a free online photo editor that turns one picture into every size you need. Crop, rotate, straighten and colour-correct your image, then watch it update live on desktop, laptop, tablet, phone and social media sizes at the same time.',
      'Pick JPEG, WebP or PNG, set a quality or a maximum file size in KB, and download each version or all of them as a ZIP. Nothing is uploaded: your images are processed privately on your own device.',
    ],
    steps: [
      'Drop, paste or choose an image (or try the sample).',
      'Crop it with a free or locked aspect ratio, then rotate, flip or straighten it.',
      'Adjust brightness, contrast, saturation and more, or apply a one-click look.',
      'Choose the output format and a quality or target file size.',
      'Check every live viewport, then download one size or export them all as a ZIP.',
    ],
    stepsTitle: 'How to resize, crop and compress an image',
    faq: [],
    config: {},
  },
  {
    slug: 'resize-image-for-instagram',
    title: 'Resize Image for Instagram: Post, Portrait & Story | iLoveImages',
    description: 'Resize photos for Instagram posts (1080×1080), portrait posts (1080×1350) and Stories or Reels (1080×1920) at once. Free, no upload, no watermark.',
    h1: 'Resize image for Instagram',
    appName: 'Instagram image resizer',
    intro: [
      'Get every Instagram size from one photo. The square post, 4:5 portrait post and 9:16 Story/Reel frames update live while you crop, so you can see exactly what will show in the feed and in Stories before you export.',
      'Images are exported at Instagram\'s recommended 1080 px width, which avoids the extra compression Instagram applies to oversized uploads.',
    ],
    steps: [
      'Load the photo you want to post.',
      'Move the crop box to frame your subject; the post, portrait and story previews update instantly.',
      'Optionally apply a look such as Vivid or Warm.',
      'Export JPEG at 80–90% quality for the best balance of sharpness and size.',
      'Download the size you need, or all three as a ZIP.',
    ],
    stepsTitle: 'How to resize a photo for Instagram',
    faq: [
      ['What size should an Instagram post be?', 'Use 1080 × 1080 px for square posts, 1080 × 1350 px (4:5) for portrait posts, and 1080 × 1920 px (9:16) for Stories and Reels.'],
      ['Why does Instagram make my photos blurry?', 'Instagram recompresses images that are larger than 1080 px wide or too heavy. Exporting at exactly 1080 px wide with a sensible JPEG quality keeps them crisp.'],
    ],
    config: { enabled: ['master', 'ig-post', 'ig-portrait', 'story', 'mobile'], fit: 'cover' },
  },
  {
    slug: 'resize-image-for-youtube-thumbnail',
    title: 'YouTube Thumbnail Resizer: 1280×720 Under 2 MB | iLoveImages',
    description: 'Make a YouTube thumbnail at 1280×720 (16:9) under YouTube\'s 2 MB limit. Crop, brighten and preview it on desktop and mobile. Free and private.',
    h1: 'YouTube thumbnail resizer',
    appName: 'YouTube thumbnail resizer',
    intro: [
      'Turn any screenshot or photo into a YouTube thumbnail that meets every requirement: 1280 × 720 pixels, a 16:9 aspect ratio and a file under 2 MB.',
      'The crop is locked to 16:9 and the file size target is set to 2 MB, so the export is ready to upload. Live previews show how it reads on a desktop screen and on a phone.',
    ],
    steps: [
      'Load your screenshot or design.',
      'Drag the 16:9 crop box to frame the key moment.',
      'Boost contrast and saturation so it stands out in search results.',
      'Keep the 2,000 KB target so the file is accepted by YouTube.',
      'Download the YouTube thumbnail size.',
    ],
    stepsTitle: 'How to make a YouTube thumbnail',
    faq: [
      ['What is the correct YouTube thumbnail size?', '1280 × 720 pixels (16:9), with a minimum width of 640 pixels. The file must be under 2 MB and in JPG, PNG or GIF format.'],
    ],
    config: { enabled: ['master', 'yt-thumb', 'og', 'desktop', 'mobile'], aspect: 1.7778, mode: 'target', targetKB: 2000, format: 'image/jpeg' },
  },
  {
    slug: 'compress-image-to-100kb',
    title: 'Compress Image to 100KB Online: JPG, PNG, WebP | iLoveImages',
    description: 'Reduce any photo to under 100 KB without guessing. The tool finds the best quality that fits, for one size or many. Free, private, no upload.',
    h1: 'Compress image to 100 KB',
    appName: 'Compress image to 100 KB',
    intro: [
      'Need a picture under 100 KB for an email, a website or an online form? Set the limit once and iLoveImages finds the highest quality that stays under it automatically, for every size you have switched on.',
      'If an image is still too heavy at low quality, the tool can reduce its dimensions step by step until it fits, and tells you when it did.',
    ],
    steps: [
      'Load your image.',
      'Leave Compression on "Target size" with 100 KB (or type another limit).',
      'Choose JPEG or WebP for the smallest files.',
      'Wait for the status light to turn green; each card shows the final size and quality used.',
      'Download the file that matches your requirement.',
    ],
    stepsTitle: 'How to compress an image to 100 KB',
    faq: [
      ['How does the tool hit an exact file size?', 'It encodes the image repeatedly, binary-searching the quality setting until the file is as large as possible without going over your limit. The result lands just under the target, never over it.'],
      ['Which format gives the smallest file?', 'WebP is usually 25–35% smaller than JPEG at the same visual quality. Use JPEG when the destination does not accept WebP.'],
    ],
    config: { mode: 'target', targetKB: 100, format: 'image/jpeg' },
  },
  {
    slug: 'compress-image-to-50kb',
    title: 'Compress Image to 50KB for Forms & Uploads | iLoveImages',
    description: 'Shrink photos, signatures and documents to under 50 KB for online applications and upload forms. Crop, resize and compress in your browser for free.',
    h1: 'Compress image to 50 KB',
    appName: 'Compress image to 50 KB',
    intro: [
      'Online application forms often reject photos and signatures over 50 KB. Load your image, crop it to the required shape, and download a file that is guaranteed to be under the limit.',
      'Because everything runs on your device, personal documents and ID photos are never uploaded anywhere.',
    ],
    steps: [
      'Load your photo or scanned signature.',
      'Crop it tightly; use 1:1 or 4:5 for passport-style photos.',
      'Keep Compression on "Target size" at 50 KB, with "Shrink dimensions if needed" on.',
      'Check the Master crop card for the final size and dimensions.',
      'Download and upload it to your form.',
    ],
    stepsTitle: 'How to compress an image to 50 KB',
    faq: [
      ['Can I compress a photo to 20 KB or 30 KB?', 'Yes. Type any number into the target size box. Very small limits may also reduce the image dimensions so the result stays clear rather than blocky.'],
    ],
    config: { mode: 'target', targetKB: 50, allowDownscale: true, format: 'image/jpeg', enabled: ['master', 'thumb', 'ig-post', 'mobile'] },
  },
  {
    slug: 'crop-image',
    title: 'Crop Image Online: Free Photo Cropper with Ratios | iLoveImages',
    description: 'Crop photos online with free or fixed aspect ratios (1:1, 4:5, 4:3, 3:2, 16:9, 9:16), plus rotate, flip and straighten. Free, private and instant.',
    h1: 'Crop image online',
    appName: 'Online image cropper',
    intro: [
      'Crop a photo precisely with drag handles, rule-of-thirds guides and aspect-ratio locks for square, portrait, landscape and vertical video formats.',
      'Rotate in 90° steps, flip horizontally or vertically, and straighten tilted horizons up to ±45° with automatic zoom so no empty corners appear.',
    ],
    steps: [
      'Load your image.',
      'Choose an aspect ratio or keep Free.',
      'Drag the crop box and its handles; use the arrow keys to nudge it.',
      'Rotate, flip or straighten if needed.',
      'Download the Master crop at full resolution, or any resized version.',
    ],
    stepsTitle: 'How to crop an image',
    faq: [
      ['Does cropping reduce resolution?', 'The Master crop keeps every original pixel inside the crop box at full resolution. Only the resized viewport versions are scaled.'],
    ],
    config: { tab: 't-crop' },
  },
  {
    slug: 'convert-image-to-webp',
    title: 'Convert Image to WebP Online: JPG & PNG to WebP | iLoveImages',
    description: 'Convert JPG and PNG images to WebP for faster websites, with quality control, resizing and transparency support. Free, private, no upload.',
    h1: 'Convert image to WebP',
    appName: 'Image to WebP converter',
    intro: [
      'WebP images are typically 25–35% smaller than JPEG and much smaller than PNG, which makes pages load faster and improves Core Web Vitals.',
      'Convert a JPG or PNG to WebP, keep transparency if you need it, and generate desktop, tablet and mobile sizes for responsive images at the same time.',
    ],
    steps: [
      'Load a JPG, PNG or other image.',
      'WebP is preselected; set quality around 75–85% for photos.',
      'Tick "Transparent" to keep transparent backgrounds from PNG files.',
      'Compare the file size savings on each card.',
      'Download the WebP files or export them all as a ZIP.',
    ],
    stepsTitle: 'How to convert an image to WebP',
    faq: [
      ['Do all browsers support WebP?', 'Yes. All current versions of Chrome, Edge, Firefox and Safari display WebP images.'],
    ],
    config: { format: 'image/webp', mode: 'quality', quality: 80 },
  },
  {
    slug: 'responsive-image-generator',
    title: 'Responsive Image Generator for Desktop & Mobile | iLoveImages',
    description: 'Generate responsive image sizes for desktop, laptop, tablet and mobile from one picture, preview each crop live and export them all in one ZIP.',
    h1: 'Responsive image generator',
    appName: 'Responsive image generator',
    intro: [
      'Serving one huge image to every device slows your site down. Generate a correctly sized file for each breakpoint (1920 px desktop, 1366 px laptop, 768 px tablet and 390 px mobile) and see how each crop looks before you export.',
      'Use the files with srcset or the picture element so every visitor downloads only the size their screen needs.',
    ],
    steps: [
      'Load your hero or banner image.',
      'Position the crop so the subject stays visible on wide and tall screens.',
      'Pick "Fill" to crop each breakpoint exactly, or "Fit inside" to keep the full image.',
      'Choose WebP or JPEG and a quality.',
      'Export all sizes as a ZIP and reference them in srcset.',
    ],
    stepsTitle: 'How to generate responsive images',
    faq: [
      ['What image sizes do I need for a responsive website?', 'A common set is 1920, 1366, 768 and 390 pixels wide, covering desktop, laptop, tablet and mobile screens. Add 2× versions for high-density displays where it matters.'],
    ],
    config: { enabled: ['master', 'desktop', 'laptop', 'tablet', 'mobile'], format: 'image/webp', fit: 'cover' },
  },
];

// ---------------------------------------------------------------------------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlFor = slug => (slug ? `${SITE}/${slug}/` : `${SITE}/`);
const pathFor = slug => (slug ? `/${slug}/` : '/');
// Escape "</" so JSON-LD can never close its <script> tag early.
const jsonLd = obj => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

function structuredData(page) {
  const url = urlFor(page.slug);
  const faq = [...page.faq, ...SHARED_FAQ];
  const graph = [
    {
      '@type': 'WebApplication',
      '@id': `${url}#app`,
      name: page.appName,
      url,
      description: page.description,
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: 'Image editor',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript and a modern web browser',
      isAccessibleForFree: true,
      inLanguage: 'en',
      image: OG_IMAGE,
      screenshot: OG_IMAGE,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        'Crop with aspect-ratio lock', 'Rotate, flip and straighten', 'Brightness, contrast, saturation, hue and filters',
        'Resize to many screen and social media sizes at once', 'Compress to a target file size in KB',
        'Export JPEG, WebP, PNG and AVIF', 'Batch download as ZIP', 'Runs locally in the browser, no uploads',
      ],
      publisher: { '@id': `${SITE}/#org` },
    },
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];
  graph.push({ '@type': 'Organization', '@id': `${SITE}/#org`, name: BRAND, url: `${SITE}/`, logo: `${SITE}/icon-512.png` });
  if (page.slug) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: BRAND, item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url },
      ],
    });
  } else {
    graph.push({ '@type': 'WebSite', '@id': `${SITE}/#website`, name: BRAND, url: `${SITE}/`, description: page.description, inLanguage: 'en', publisher: { '@id': `${SITE}/#org` } });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function head(page) {
  const url = urlFor(page.slug);
  return `  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="canonical" href="${url}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="theme-color" content="#03060c">
  <meta name="color-scheme" content="dark">
  <meta name="application-name" content="${BRAND}">
  <meta name="apple-mobile-web-app-title" content="${BRAND}">
  <meta name="format-detection" content="telephone=no">

  <!-- Icons & PWA manifest -->
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

  <!-- Open Graph / social previews -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:alt" content="iLoveImages editor showing one image cropped and resized live for desktop, tablet, phone and social media">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(page.title)}">
  <meta name="twitter:description" content="${esc(page.description)}">
  <meta name="twitter:image" content="${OG_IMAGE}">

  <script type="application/ld+json">
${jsonLd(structuredData(page))}
  </script>
`;
}

function guide(page) {
  const faq = [...page.faq, ...SHARED_FAQ];
  const others = TOOLS.filter(t => t.slug !== page.slug);
  const crumbs = page.slug
    ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">${BRAND}</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(page.h1)}</span></nav>`
    : '';
  return `  <!-- ============ Guide: indexable help content ============ -->
  <section class="guide" id="guide" aria-labelledby="guide-title">
    <div class="guide-head">
      <span class="guide-kicker"><i>//</i>Guide</span>
      <button type="button" class="btn small" id="guide-close">Close</button>
    </div>
    <article>
      ${crumbs}
      <h2 id="guide-title">${esc(page.h1)}: free, private and in your browser</h2>
${page.intro.map(p => `      <p>${esc(p)}</p>`).join('\n')}

      <h2>${esc(page.stepsTitle)}</h2>
      <ol>
${page.steps.map(s => `        <li>${esc(s)}</li>`).join('\n')}
      </ol>

      <h2>Features</h2>
      <ul>
        <li><strong>Live multi-size preview:</strong> every viewport redraws as you crop and edit, then shows the real encoded file size.</li>
        <li><strong>Crop &amp; transform:</strong> aspect-ratio lock, rotate, flip and straighten.</li>
        <li><strong>Adjust:</strong> brightness, contrast, saturation, hue, mono, sepia, blur, vignette and one-click looks.</li>
        <li><strong>Compression:</strong> pick a quality, or a maximum size in KB and let the tool find the best quality.</li>
        <li><strong>Formats:</strong> JPEG, WebP, PNG and AVIF (where supported), with transparent backgrounds.</li>
        <li><strong>Private:</strong> no uploads, no account, no watermark.</li>
      </ul>

      <h2>Built-in image sizes</h2>
      <table>
        <thead><tr><th scope="col">Viewport</th><th scope="col">Pixels</th><th scope="col">Best for</th></tr></thead>
        <tbody>
${SIZES.map(([n, d, u]) => `          <tr><td>${esc(n)}</td><td>${esc(d)}</td><td>${esc(u)}</td></tr>`).join('\n')}
        </tbody>
      </table>
      <p>Need something else? Add any custom width and height in the Viewports tab.</p>

      <h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `      <details>
        <summary>${esc(q)}</summary>
        <p>${esc(a)}</p>
      </details>`).join('\n')}

      <h2>More free image tools</h2>
      <nav aria-label="Image tools">
        <ul class="tool-links">
${page.slug ? `          <li><a href="/">Image resizer, cropper &amp; compressor</a></li>\n` : ''}${others.map(t => `          <li><a href="${pathFor(t.slug)}">${esc(t.label)}</a></li>`).join('\n')}
        </ul>
      </nav>
    </article>
    <footer class="guide-foot">© ${new Date().getFullYear()} ${BRAND} · Images are processed on your device and never uploaded.</footer>
  </section>`;
}

function render(template, page) {
  const attrs = Object.keys(page.config).length ? ` data-config="${esc(JSON.stringify(page.config))}"` : '';
  return template
    .replace('{{HEAD}}', head(page).trimEnd())
    .replace('{{BODY_ATTRS}}', attrs)
    .replace('{{H1}}', esc(page.h1))
    .replace('{{GUIDE}}', guide(page));
}

function notFound() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found | ${BRAND}</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#03060c">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #03060c; color: #d8f6ff; font: 16px/1.5 system-ui, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
    h1 { font-size: 22px; letter-spacing: 0.2em; text-transform: uppercase; color: #40e8ff; margin: 0 0 8px; }
    a { color: #40e8ff; }
    ul { list-style: none; padding: 0; margin: 20px 0 0; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <main>
    <h1>Signal lost: 404</h1>
    <p>This page doesn't exist. Try one of the tools:</p>
    <ul>
      <li><a href="/">Image resizer, cropper &amp; compressor</a></li>
${TOOLS.map(t => `      <li><a href="${pathFor(t.slug)}">${esc(t.label)}</a></li>`).join('\n')}
    </ul>
  </main>
</body>
</html>
`;
}

function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map(p => `  <url>
    <loc>${urlFor(p.slug)}</loc>
    <lastmod>${TODAY}</lastmod>
  </url>`).join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------------------
const template = readFileSync(join(ROOT, 'src/template.html'), 'utf8');
for (const page of PAGES) {
  if (page.title.length > 65) console.warn(`! title ${page.title.length} chars: ${page.title}`);
  if (page.description.length > 160) console.warn(`! description ${page.description.length} chars: ${page.slug || 'home'}`);
  const file = page.slug ? join(ROOT, page.slug, 'index.html') : join(ROOT, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(template, page));
  console.log(`wrote ${file.slice(ROOT.length + 1)}`);
}
writeFileSync(join(ROOT, '404.html'), notFound());
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap());
console.log('wrote 404.html, sitemap.xml');
