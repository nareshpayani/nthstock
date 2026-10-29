import { buttonVariants, cn } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { imageFile, videoFile, type GuideBlock, type GuideImage } from '../model/guideContent';
import { strings } from '../strings';
import { GuideDiagram } from './GuideDiagram';

/** A table that scrolls sideways on its own on a phone, reachable by keyboard (WCAG 2.1.1). */
function GuideTable({ block }: { block: Extract<GuideBlock, { kind: 'table' }> }) {
  // Wide numeric tables keep each cell on one line and scroll instead of wrapping into columns of
  // single words on a phone.
  const compact = block.head.length >= 5;
  return (
    <div
      role="region"
      aria-label={block.caption}
      tabIndex={0}
      className="relative overflow-x-auto rounded-md border border-line outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <table
        className={cn(
          'w-full min-w-[32rem] border-collapse text-left text-body',
          compact && '[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap',
        )}
      >
        <caption className="border-b border-line bg-canvas px-3 py-2 text-left text-label font-semibold text-ink-muted">
          {block.caption}
        </caption>
        <thead>
          <tr className="border-b border-line">
            {block.head.map((cell) => (
              <th key={cell} scope="col" className="px-3 py-2 font-semibold text-ink">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join('|')} className="border-b border-line last:border-b-0">
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={cell} scope="row" className="px-3 py-2 align-top font-medium text-ink">
                    {cell}
                  </th>
                ) : (
                  <td key={`${String(index)}-${cell}`} className="px-3 py-2 align-top text-ink">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A captured frame, linked to its full-size file. Phone frames are portrait and capped in height,
 * so a pair sits side by side even on a 320 px screen; wide frames fill their column.
 */
function GuideStill({ image, label }: { image: GuideImage; label: string }) {
  const portrait = image.height > image.width;
  return (
    <figure className="grid content-start gap-1.5">
      <figcaption className="text-label font-semibold text-ink-muted">{label}</figcaption>
      <a
        href={imageFile(image.file)}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <img
          src={imageFile(image.file)}
          alt={image.alt}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          className={cn(
            'h-auto rounded-sm border border-line bg-canvas',
            portrait ? 'mx-auto max-h-[36rem] w-auto max-w-full' : 'w-full',
          )}
        />
        <span className="sr-only"> {strings.opensInNewTab}</span>
      </a>
    </figure>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case 'text':
      return <p className="text-body text-ink">{block.text}</p>;
    case 'heading':
      return <h3 className="pt-2 text-lg font-semibold text-ink">{block.text}</h3>;
    case 'list':
      return (
        <ul className="grid list-disc gap-1.5 pl-5 text-body text-ink">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="grid list-decimal gap-2 pl-5 text-body text-ink marker:font-semibold marker:text-brand">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case 'table':
      return <GuideTable block={block} />;
    case 'code':
      return (
        <figure className="grid gap-1">
          <figcaption className="font-mono text-label text-ink-muted">{block.label}</figcaption>
          {/* A scrollable region, reachable by keyboard, for lines wider than a phone. */}
          <div
            role="region"
            aria-label={block.label}
            tabIndex={0}
            className="relative overflow-x-auto rounded-md bg-canvas outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <pre className="px-3 py-2 font-mono text-label leading-5 text-ink">
              <code>{block.text}</code>
            </pre>
          </div>
        </figure>
      );
    case 'facts':
      return (
        <dl
          aria-label={block.label}
          className="grid gap-3 rounded-md bg-brand-soft p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {block.items.map((item) => (
            <div key={item.term} className="grid content-start gap-0.5">
              <dt className="text-label text-ink-muted">{item.term}</dt>
              <dd className="text-body font-semibold [overflow-wrap:anywhere] text-ink">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'cards':
      return (
        <ul className="grid gap-3 sm:grid-cols-2">
          {block.items.map((item) => (
            <li
              key={item.name}
              className="grid content-start gap-1 rounded-md border border-line p-3"
            >
              <h3 className="text-body font-semibold text-ink">{item.name}</h3>
              <p className="text-body text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      );
    case 'videos':
      return (
        <ul aria-label={block.label} className="grid gap-4 sm:grid-cols-2">
          {block.items.map((video) => (
            <li
              key={video.id}
              className="grid content-start gap-2 rounded-md border border-line p-3"
            >
              {/* preload="none": only the poster loads until the reader presses play. The
                  captions track is off by default, since the clip already shows its captions. */}
              <video
                controls
                playsInline
                preload="none"
                poster={videoFile(video.id, 'jpg')}
                aria-label={strings.videoLabel(video.title, video.device)}
                className={cn(
                  'rounded-sm bg-canvas object-contain',
                  // A phone clip is portrait: as tall as a desktop card's player, centred.
                  video.device === 'Phone'
                    ? 'mx-auto aspect-[390/844] h-96 w-auto'
                    : 'aspect-video w-full',
                )}
              >
                <source src={videoFile(video.id, 'mp4')} type="video/mp4" />
                <track
                  kind="captions"
                  src={videoFile(video.id, 'vtt')}
                  srcLang="en"
                  label={strings.captionsLabel}
                />
                <a href={videoFile(video.id, 'mp4')}>{strings.videoFallback(video.title)}</a>
              </video>
              <h3 className="text-body font-semibold text-ink">{video.title}</h3>
              <p className="text-label text-ink-muted">
                {video.device} · {video.length}
              </p>
              <p className="text-body text-ink-muted">{video.body}</p>
            </li>
          ))}
        </ul>
      );
    case 'diagram':
      return <GuideDiagram id={block.id} />;
    case 'compare':
      return (
        <ul aria-label={block.label} className="grid gap-4">
          {block.items.map((item) => (
            <li key={item.title} className="grid gap-3 rounded-md border border-line p-3">
              <h3 className="text-body font-semibold text-ink">{item.title}</h3>
              <div
                className={cn(
                  'grid gap-3',
                  item.after.height > item.after.width ? 'grid-cols-2' : 'sm:grid-cols-2',
                )}
              >
                <GuideStill image={item.before} label={block.captions?.before ?? strings.before} />
                <GuideStill image={item.after} label={block.captions?.after ?? strings.after} />
              </div>
              <p className="text-body text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      );
    case 'figures':
      return (
        <ul aria-label={block.label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {block.items.map((item) => (
            <li key={item.image.file} className="grid content-start">
              <GuideStill image={item.image} label={item.caption} />
            </li>
          ))}
        </ul>
      );
    case 'links':
      return (
        <div className="grid gap-2 border-t border-line pt-4">
          <h3 className="text-label font-semibold text-ink-muted uppercase">{block.label}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {block.items.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-sm text-body font-medium text-brand hover:underline"
                >
                  {link.label}
                  <span className="sr-only"> {strings.opensInNewTab}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'note':
      return (
        <p className="rounded-md border border-line bg-canvas p-3 text-label text-ink-muted">
          {block.text}
        </p>
      );
    case 'loginCta':
      return (
        <div>
          {block.href ? (
            // A plain link: the query is the login route's own (`?try=1` starts the demo).
            <a href={block.href} className={buttonVariants({ variant: 'primary' })}>
              {block.label}
            </a>
          ) : (
            <Link to="/login" className={buttonVariants({ variant: 'primary' })}>
              {block.label}
            </Link>
          )}
        </div>
      );
  }
}

/** A guide tab's content, block by block, in the order the copy lists them. */
export function GuideBlocks({ blocks }: { blocks: readonly GuideBlock[] }) {
  return (
    <div className="grid gap-4">
      {blocks.map((block, index) => (
        // The copy is static and never reordered, so a block's position is a stable key.
        <Block key={`${block.kind}-${String(index)}`} block={block} />
      ))}
    </div>
  );
}
