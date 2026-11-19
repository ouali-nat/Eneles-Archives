"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Upload } from "@/components/icons"

/** The pages a file can be dropped on, what each takes, and what the overlay calls it. */
export const DROP_ZONE_CONFIG: Record<string, { label: string; accept: (f: File) => boolean }> = {
  '/pdfs':     { label: 'PDF',        accept: (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') },
  '/snips':    { label: 'image',      accept: (f) => f.type.startsWith('image/') },
  '/projects': { label: '.tex / ZIP', accept: (f) => f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.tex') },
}

/** Listens for files dragged over the page and hands a matching drop to the page's list (the texer:file-drop event), with the overlay while one is over it. */
export function DropZoneWrapper({ pathname, children }: { pathname: string | null; children: React.ReactNode }) {
  const config = Object.entries(DROP_ZONE_CONFIG).find(([p]) => pathname === p)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    if (!config) return
    const { accept } = config[1]

    const hasMatch = (dt: DataTransfer) => {
      const items = Array.from(dt.items)
      return items.length > 0
        ? items.some(i => accept({ type: i.type, name: '', toLowerCase: () => '' } as any))
        : Array.from(dt.files).some(accept)
    }

    const onEnter = (e: DragEvent) => { e.preventDefault(); dragCounter.current++; if (e.dataTransfer && hasMatch(e.dataTransfer)) setIsDragOver(true) }
    const onOver  = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' }
    const onLeave = (e: DragEvent) => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragOver(false) } }
    const onDrop  = (e: DragEvent) => {
      e.preventDefault(); dragCounter.current = 0; setIsDragOver(false)
      const file = e.dataTransfer?.files[0]
      if (file && accept(file)) window.dispatchEvent(new CustomEvent('texer:file-drop', { detail: file }))
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover',  onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop',      onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover',  onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop',      onDrop)
    }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex min-h-full flex-col">
      {children}
      <DropOverlay label={isDragOver && config ? config[1].label : null} />
    </div>
  )
}


/** The overlay a file dragged over a page shows, naming what the page takes ("PDF", "image"); nothing while `label` is null. The desktop app, where the system hands it the drag, shows it too. */
export function DropOverlay({ label }: { label: string | null }) {
  return (
    <AnimatePresence>
      {label && (
        <motion.div
          key="drop-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-50 pointer-events-none overflow-hidden"
          style={{
            background: 'radial-gradient(ellipse at center, color-mix(in oklch, var(--accent) 18%, transparent) 0%, color-mix(in oklch, var(--background) 92%, transparent) 70%)',
            backdropFilter: 'blur(6px)',
          }}
        >
          {/* Animated dashed border: SVG rect around the full edge */}
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" style={{ pointerEvents: 'none' }}>
            <motion.rect
              x="6" y="6"
              width="calc(100% - 12px)" height="calc(100% - 12px)"
              rx="16" ry="16"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeDasharray="12 8"
              initial={{ strokeDashoffset: 0, opacity: 0.5 }}
              animate={{ strokeDashoffset: -80, opacity: [0.5, 1, 0.5] }}
              transition={{ strokeDashoffset: { duration: 2, repeat: Infinity, ease: 'linear' }, opacity: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } }}
              style={{ width: 'calc(100% - 12px)', height: 'calc(100% - 12px)' }}
            />
          </svg>

          {/* Floating ambient blobs */}
          {[
            { x: '15%', y: '20%', size: 220, delay: 0 },
            { x: '78%', y: '65%', size: 180, delay: 0.4 },
            { x: '55%', y: '85%', size: 140, delay: 0.8 },
          ].map((blob, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                left: blob.x, top: blob.y,
                width: blob.size, height: blob.size,
                background: 'radial-gradient(circle, color-mix(in oklch, var(--accent) 15%, transparent) 0%, transparent 70%)',
                transform: 'translate(-50%, -50%)',
              }}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [0.8, 1.1, 0.8], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 3 + i * 0.6, repeat: Infinity, ease: 'easeInOut', delay: blob.delay }}
            />
          ))}

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 select-none">
            {/* Icon with pulse rings */}
            <div className="relative flex items-center justify-center">
              {[1, 2, 3].map(ring => (
                <motion.div
                  key={ring}
                  className="absolute rounded-full border border-accent/40"
                  initial={{ width: 72, height: 72, opacity: 0.6 }}
                  animate={{ width: 72 + ring * 44, height: 72 + ring * 44, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: ring * 0.5 }}
                />
              ))}
              <motion.div
                className="relative z-10 rounded-full flex items-center justify-center"
                style={{
                  width: 88, height: 88,
                  background: 'radial-gradient(circle, color-mix(in oklch, var(--accent) 30%, transparent) 0%, color-mix(in oklch, var(--accent) 12%, transparent) 100%)',
                  boxShadow: '0 0 40px color-mix(in oklch, var(--accent) 40%, transparent), 0 0 80px color-mix(in oklch, var(--accent) 20%, transparent)',
                  border: '1.5px solid color-mix(in oklch, var(--accent) 50%, transparent)',
                }}
                animate={{ boxShadow: ['0 0 30px color-mix(in oklch, var(--accent) 30%, transparent)', '0 0 60px color-mix(in oklch, var(--accent) 50%, transparent)', '0 0 30px color-mix(in oklch, var(--accent) 30%, transparent)'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Upload className="h-10 w-10 text-foreground" strokeWidth={1.5} />
              </motion.div>
            </div>

            {/* Text */}
            <motion.div
              className="flex flex-col items-center gap-2 text-center"
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.05, duration: 0.25 }}
            >
              <p
                className="text-3xl font-bold tracking-tight"
                style={{ background: 'linear-gradient(135deg, var(--foreground) 0%, var(--accent) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
              >
                Drop your {label} here
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                Release to instantly upload
              </p>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
