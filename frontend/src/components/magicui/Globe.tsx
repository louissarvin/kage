import createGlobe from "cobe";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const Globe = ({ className }: { className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Wait for container to be properly sized
  useEffect(() => {
    if (!divRef.current) return;

    const checkReady = () => {
      if (divRef.current && divRef.current.offsetWidth > 0) {
        setIsReady(true);
      }
    };

    // Check immediately and after a delay
    checkReady();
    const timeout = setTimeout(checkReady, 100);

    return () => clearTimeout(timeout);
  }, []);

  // Create globe only when ready
  useEffect(() => {
    if (!isReady || !canvasRef.current || !divRef.current) return;

    let phi = 0;
    let width = divRef.current.offsetWidth;

    const onResize = () => {
      if (divRef.current) {
        width = divRef.current.offsetWidth;
      }
    };

    window.addEventListener('resize', onResize);

    globeRef.current = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: 0,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.1, 0.1, 0.1],
      markerColor: [0.53, 0.34, 1],
      glowColor: [0.36, 0.72, 0.89],
      markers: [
        { location: [37.7595, -122.4367], size: 0.03 },
        { location: [40.7128, -74.006], size: 0.1 },
      ],
      onRender: (state) => {
        state.phi = phi;
        state.width = width * 2;
        state.height = width * 2;
        phi += 0.005;
      },
    });

    // Fade in after globe is created
    requestAnimationFrame(() => {
      if (canvasRef.current) {
        canvasRef.current.style.opacity = '1';
      }
    });

    return () => {
      globeRef.current?.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, [isReady]);

  return (
    <div
      ref={divRef}
      className={cn(
        "flex items-center justify-center z-[10] w-full aspect-square mx-auto",
        className
      )}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: 0,
          transition: 'opacity 1s ease',
        }}
      />
    </div>
  );
};
