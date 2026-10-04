'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Detector = {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
};
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

function detectorClass(): DetectorConstructor | null {
  const value = (globalThis as { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;
  return typeof value === 'function' ? value : null;
}

// Camera QR scanning where the browser provides a detector. Typing the code is
// always available, so this is an enhancement, never a requirement.
export function CodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    // Feature detection must run in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(
      detectorClass() !== null && Boolean(navigator.mediaDevices?.getUserMedia),
    );
  }, []);
  useEffect(() => {
    if (!open) return;
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const detector = new Detector({ formats: ['qr_code'] });
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (media) => {
        stream = media;
        if (stopped || !video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        const scan = async () => {
          if (stopped || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          const value = found[0]?.rawValue?.trim();
          if (value) {
            onCode(value);
            setOpen(false);
            return;
          }
          frame = requestAnimationFrame(() => void scan());
        };
        void scan();
      })
      .catch(() => {
        setError('Camera unavailable. Type the code instead.');
        setOpen(false);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, onCode]);
  if (!supported) return null;
  return (
    <div className="grid gap-2">
      {open ? (
        <>
          <video
            ref={video}
            muted
            playsInline
            aria-label="Camera preview for scanning the shopper's QR code"
            style={{
              width: '100%',
              borderRadius: 'var(--radius-card)',
              background: '#000',
            }}
          />
          <Button
            variant="outline"
            type="button"
            onClick={() => setOpen(false)}
          >
            <X size={17} aria-hidden /> Stop camera
          </Button>
        </>
      ) : (
        <Button variant="outline" type="button" onClick={() => setOpen(true)}>
          <Camera size={17} aria-hidden /> Scan QR code
        </Button>
      )}
      {error && <p className="small-note">{error}</p>}
    </div>
  );
}
