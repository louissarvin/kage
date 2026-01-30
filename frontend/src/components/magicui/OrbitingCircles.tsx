"use client"

import React from "react"
import { cn } from "@/lib/utils"

export interface OrbitingCirclesProps
  extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
  children?: React.ReactNode
  reverse?: boolean
  duration?: number
  delay?: number
  radius?: number
  path?: boolean
  iconSize?: number
  speed?: number
}

export function OrbitingCircles({
  className,
  children,
  reverse,
  duration = 20,
  delay: _delay = 10,
  radius = 160,
  path = true,
  iconSize = 30,
  speed = 1,
}: OrbitingCirclesProps) {
  const calculatedDuration = duration / speed
  const childrenArray = React.Children.toArray(children)

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {path && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          className="pointer-events-none absolute"
          style={{
            width: radius * 2,
            height: radius * 2,
          }}
        >
          <circle
            className="stroke-black/30"
            cx={radius}
            cy={radius}
            r={radius}
            fill="none"
          />
        </svg>
      )}

      {childrenArray.map((child, index) => {
        const itemDelay = (index * calculatedDuration) / childrenArray.length

        return (
          <div
            key={index}
            style={{
              "--duration": `${calculatedDuration}s`,
              "--radius": `${radius}px`,
              "--icon-size": `${iconSize}px`,
              animationDelay: `-${itemDelay}s`,
            } as React.CSSProperties}
            className={cn(
              "absolute flex size-[var(--icon-size)] items-center justify-center",
              reverse ? "animate-orbit-reverse" : "animate-orbit",
              className
            )}
          >
            {child}
          </div>
        )
      })}

      <style>{`
        @keyframes orbit {
          from {
            transform: rotate(0deg) translateX(var(--radius)) rotate(0deg);
          }
          to {
            transform: rotate(360deg) translateX(var(--radius)) rotate(-360deg);
          }
        }
        @keyframes orbit-reverse {
          from {
            transform: rotate(360deg) translateX(var(--radius)) rotate(-360deg);
          }
          to {
            transform: rotate(0deg) translateX(var(--radius)) rotate(0deg);
          }
        }
        .animate-orbit {
          animation: orbit var(--duration) linear infinite;
        }
        .animate-orbit-reverse {
          animation: orbit-reverse var(--duration) linear infinite;
        }
      `}</style>
    </div>
  )
}
