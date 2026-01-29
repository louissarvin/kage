"use client"

import React, { useEffect, useMemo, useState, useRef } from "react"
import { cn } from "@/lib/utils"

export interface AnimatedListProps {
  className?: string
  children: React.ReactNode
  delay?: number
  initialCount?: number
}

export function AnimatedList({
  className,
  children,
  delay = 1000,
  initialCount = 4,
}: AnimatedListProps) {
  const [index, setIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const childrenArray = React.Children.toArray(children)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isHovered) return

    const interval = setInterval(() => {
      setIndex((prevIndex) => prevIndex + 1)
    }, delay)

    return () => clearInterval(interval)
  }, [delay, isHovered])

  const itemsToShow = useMemo(() => {
    // Create an infinite loop effect by cycling through items
    const result = []
    for (let i = 0; i < initialCount; i++) {
      const itemIndex = (index + i) % childrenArray.length
      result.push({
        item: childrenArray[itemIndex],
        key: `${index}-${i}`,
      })
    }
    return result
  }, [index, childrenArray, initialCount])

  return (
    <div 
      ref={containerRef}
      className={cn("flex flex-col items-center gap-3 overflow-hidden", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {itemsToShow.map(({ item, key }, idx) => (
        <div
          key={key}
          className={cn(
            "mx-auto w-full transition-all duration-300 ease-out",
            idx === 0 && isHovered && "animate-slide-down"
          )}
          style={{
            opacity: 1 - idx * 0.2,
            transform: `scale(${1 - idx * 0.02})`,
          }}
        >
          {item}
        </div>
      ))}
      <style>{`
        @keyframes slide-down {
          from {
            opacity: 0;
            transform: translateY(-30px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-slide-down {
          animation: slide-down 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
