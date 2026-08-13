"use client";

/**
 * D-1 — PDF page renderer using pdf.js.
 *
 * Renders a single PDF page onto a <canvas> and optionally draws an amber
 * highlight box for a bounding-box returned by the extraction pipeline.
 * The highlight is redrawn whenever `bbox` changes without re-loading the PDF.
 */
import { useEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";

export interface PdfCanvasBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfCanvasProps {
  url: string;
  page?: number;
  bbox?: PdfCanvasBbox | null;
  className?: string;
}

export function PdfCanvas({ url, page = 1, bbox, className }: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightRef = useRef<HTMLCanvasElement>(null);
  // Unscaled (user-space) page dimensions, stored after a successful render so
  // the bbox highlight can be repainted without reloading the PDF.
  const pageDims = useRef<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Repaint the amber highlight overlay whenever bbox changes.
  function paintHighlight(
    dims: { width: number; height: number } | null,
    canvasEl: HTMLCanvasElement,
    hlEl: HTMLCanvasElement,
    box: PdfCanvasBbox | null | undefined
  ) {
    hlEl.width = canvasEl.width;
    hlEl.height = canvasEl.height;
    const hc = hlEl.getContext("2d");
    if (!hc) return;
    hc.clearRect(0, 0, hlEl.width, hlEl.height);

    if (!box || !dims || box.width <= 0 || box.height <= 0) return;

    const pxPerUnit = canvasEl.width / dims.width;
    // PDF Y-axis is bottom-up; canvas is top-down — flip here.
    const sx = Math.floor(box.x * pxPerUnit);
    const sy = Math.floor((dims.height - box.y - box.height) * pxPerUnit);
    const sw = Math.ceil(box.width * pxPerUnit);
    const sh = Math.ceil(box.height * pxPerUnit);

    hc.fillStyle = "rgba(245, 158, 11, 0.18)";
    hc.fillRect(sx, sy, sw, sh);
    hc.strokeStyle = "#f59e0b";
    hc.lineWidth = 2;
    hc.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  }

  // Phase 1: load and render the PDF page.
  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      setStatus("loading");
      setErrorMsg(null);
      pageDims.current = null;

      try {
        const pdfjs = await import("pdfjs-dist");

        // Webpack 5 / Next.js understand `new URL(moduleId, import.meta.url)`
        // and emit the referenced asset so the worker can be fetched at runtime.
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url
          ).toString();
        }

        const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (cancelled) return;

        const pageNum = Math.max(1, Math.min(page, pdf.numPages));
        const pdfPage = await pdf.getPage(pageNum);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const containerWidth = container.clientWidth || 720;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = containerWidth / baseViewport.width;
        const viewport = pdfPage.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        // pdfjs-dist 6.x: pass `canvas` directly; `canvasContext` is legacy.
        renderTask = pdfPage.render({ canvas, viewport });
        await renderTask.promise;
        if (cancelled) return;

        // Store unscaled page dims so the highlight effect can use them.
        pageDims.current = { width: baseViewport.width, height: baseViewport.height };

        // Draw initial highlight now that we have the dims.
        const hl = highlightRef.current;
        if (hl) paintHighlight(pageDims.current, canvas, hl, bbox);

        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Unknown error");
          setStatus("error");
        }
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // `bbox` intentionally excluded — highlight is repainted in phase 2.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, page]);

  // Phase 2: repaint the highlight whenever bbox changes, without reloading.
  useEffect(() => {
    if (status !== "ready") return;
    const canvas = canvasRef.current;
    const hl = highlightRef.current;
    if (canvas && hl) paintHighlight(pageDims.current, canvas, hl, bbox);
  }, [bbox, status]);

  if (status === "error") {
    return (
      <div
        className={`flex items-center justify-center bg-[#323639] text-slate-400 text-xs p-6 ${className ?? ""}`}
      >
        PDF render failed: {errorMsg}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-auto bg-[#323639] ${className ?? ""}`}>
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#323639]/90 z-10 pointer-events-none">
          <span className="text-slate-400 text-xs animate-pulse">
            Rendering page {page}…
          </span>
        </div>
      )}
      {/* Stacked: page canvas below, highlight overlay on top. */}
      <div className="relative inline-block min-w-full">
        <canvas ref={canvasRef} className="block" />
        <canvas ref={highlightRef} className="absolute top-0 left-0 pointer-events-none" />
      </div>
    </div>
  );
}
