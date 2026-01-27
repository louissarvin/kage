import createGlobe from "cobe";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const Globe = ({ className }: { className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let phi = 0;
    let width = 0;

    const onResize = () => {
        if (canvasRef.current && divRef.current) {
             width = divRef.current.offsetWidth;
        }
    }

    if (divRef.current) {
      width = divRef.current.offsetWidth;
    }

    window.addEventListener('resize', onResize)
    setTimeout(onResize, 100);

    if (!canvasRef.current) return;

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: width * 2 || 1200,
      height: width * 2 || 1200,
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
        state.width = width * 2 || 1200;
        state.height = width * 2 || 1200;
        phi += 0.005;
      },
    });

    setTimeout(() => {
        if (canvasRef.current) canvasRef.current.style.opacity = '1';
    });

    return () => {
      globe.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, []);

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
