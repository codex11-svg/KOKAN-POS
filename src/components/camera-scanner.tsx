"use client";

import { Camera, CircleHelp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

interface CameraScannerProps {
  onDetected: (value: string) => void;
  onClose: () => void;
}

export function CameraScanner({ onDetected, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Starting your camera…");
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let frame = 0;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError("Camera access is not available in this browser. You can still use a USB or Bluetooth scanner.");
          return;
        }
        const detectorApi = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!detectorApi) {
          setCameraError("Live barcode decoding is not supported here. Use a hardware scanner or product search instead.");
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new detectorApi({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
        setMessage("Hold a barcode inside the frame");

        const scanFrame = async () => {
          if (!active || !videoRef.current) return;
          try {
            if (videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              const codes = await detector.detect(videoRef.current);
              const value = codes.find((code) => code.rawValue.trim())?.rawValue;
              if (value) {
                onDetected(value.trim());
                return;
              }
            }
          } catch {
            setMessage("Keep the barcode steady and try again");
          }
          if (active) frame = window.requestAnimationFrame(() => void scanFrame());
        };
        frame = window.requestAnimationFrame(() => void scanFrame());
      } catch {
        if (active) setCameraError("Camera permission was blocked or the camera is in use. Try a barcode wedge or product search.");
      }
    };

    void start();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">QUICK ADD</span>
            <h2 id="scanner-title">Scan a barcode</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close scanner"><X size={18} /></button>
        </div>
        <div className={`camera-stage ${cameraError ? "camera-stage-error" : ""}`}>
          {cameraError ? (
            <div className="camera-message">
              <CircleHelp size={32} />
              <p>{cameraError}</p>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="camera-video" muted playsInline />
              <div className="scan-frame" aria-hidden="true"><span /><span /><span /><span /></div>
              <div className="camera-caption"><Camera size={15} /> {message}</div>
            </>
          )}
        </div>
        <p className="scanner-footnote">Your camera stays on this device. No video is uploaded.</p>
      </section>
    </div>
  );
}
