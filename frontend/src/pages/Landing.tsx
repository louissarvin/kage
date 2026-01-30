import type { FC } from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { motion } from 'framer-motion'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Header } from '@/components/layout'
import { Globe } from '@/components/magicui/Globe'
import { OrbitingCircles } from '@/components/magicui/OrbitingCircles'
import { AnimatedList } from '@/components/magicui/AnimatedList'
import shadowImg from '@/assets/shadow.png'
import solanaIcon from '@/assets/solana.svg'
import arciumIcon from '@/assets/arcium.svg'
import lightIcon from '@/assets/light.svg'
import noirIcon from '@/assets/noir.svg'

gsap.registerPlugin(ScrollTrigger)

export const Landing: FC = () => {
  const { connected } = useWallet()
  const navigate = useNavigate()

  const containerRef = useRef<HTMLDivElement>(null)
  const heroSectionRef = useRef<HTMLDivElement>(null)
  const heroContentRef = useRef<HTMLDivElement>(null)
  const globeWrapperRef = useRef<HTMLDivElement>(null)
  const globeContainerRef = useRef<HTMLDivElement>(null)
  const secondSectionRef = useRef<HTMLDivElement>(null)
  const carouselRef = useRef<HTMLDivElement>(null)
  const carouselWrapperRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const ctaSectionRef = useRef<HTMLDivElement>(null)
  const ctaHeadingRef = useRef<HTMLHeadingElement>(null)
  const ctaContentRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const newsletterCardRef = useRef<HTMLDivElement>(null)
  const footerLinksRef = useRef<HTMLDivElement>(null)

  // Carousel scroll state
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  // Check scroll position and update button visibility
  const updateScrollButtons = useCallback(() => {
    const carousel = carouselRef.current
    if (!carousel) return
    
    const { scrollLeft, scrollWidth, clientWidth } = carousel
    setCanScrollLeft(scrollLeft > 10)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
  }, [])

  // Scroll carousel by card width
  const scrollCarousel = useCallback((direction: 'left' | 'right') => {
    const carousel = carouselRef.current
    if (!carousel) return
    
    const scrollAmount = 320 // Card width + gap
    carousel.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
  }, [])

  // Add scroll listener to carousel
  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return
    
    updateScrollButtons()
    carousel.addEventListener('scroll', updateScrollButtons)
    window.addEventListener('resize', updateScrollButtons)
    
    return () => {
      carousel.removeEventListener('scroll', updateScrollButtons)
      window.removeEventListener('resize', updateScrollButtons)
    }
  }, [updateScrollButtons])

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Set initial globe wrapper position (lower, showing only top edge below content)
      gsap.set(globeWrapperRef.current, {
        y: '35vh',
      })

      // Set initial globe position (centered)
      gsap.set(globeContainerRef.current, {
        xPercent: -50,
        y: 0,
        opacity: 0,
      })

      // Globe entrance animation
      gsap.to(globeContainerRef.current, {
        opacity: 1,
        duration: 1.2,
        delay: 0.5,
        ease: 'power3.out',
      })

      // Create pinned scroll timeline
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: heroSectionRef.current,
          start: 'top top',
          end: '+=200%',
          pin: true,
          scrub: 1,
        },
      })

      // Phase 1: Text fades out, Globe rises to center
      tl.to(
        heroContentRef.current,
        {
          opacity: 0,
          y: -50,
          duration: 0.4,
          ease: 'power2.inOut',
        },
        0
      )
      .to(
        globeWrapperRef.current,
        {
          y: '-25vh',
          duration: 0.5,
          ease: 'power2.inOut',
        },
        0
      )
      .to(
        globeContainerRef.current,
        {
          scale: 1.3,
          duration: 0.5,
          ease: 'power2.inOut',
        },
        0
      )

      // Phase 2: Globe exits upward and fades out
      tl.to(
        globeWrapperRef.current,
        {
          y: '-120vh',
          opacity: 0,
          duration: 0.5,
          ease: 'power2.in',
        },
        0.5
      )

    }, containerRef)

    return () => ctx.revert()
  }, [])

  // Feature cards scroll animation - Phantom-style stacked cards
  useEffect(() => {
    const cards = cardRefs.current.filter(Boolean) as HTMLDivElement[]
    const wrapper = carouselWrapperRef.current
    if (cards.length === 0 || !wrapper) return

    // Card width + gap = ~420px per card slot
    const cardSlotWidth = 420

    const ctx = gsap.context(() => {
      // Set initial state - all cards stacked in center, below viewport
      // Each card needs to move to overlap at center position
      // Card 0 stays roughly in place, others move left to stack
      cards.forEach((card, index) => {
        // Move each card left to stack on top of first card
        // index * cardSlotWidth moves it back, then small offset for stacked look
        const stackOffset = -(index * cardSlotWidth) + (index * 12)

        gsap.set(card, {
          x: stackOffset,
          y: 400, // Start below viewport
          rotateZ: index * 0.5, // Slight rotation
          scale: 1 - (index * 0.01),
          zIndex: cards.length - index, // Front card on top
          opacity: 1,
        })
      })

      // Create scroll-triggered animation
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrapper,
          start: 'top 95%',
          end: 'top 20%',
          scrub: 1.2,
        },
      })

      // Phase 1: Cards rise up (still stacked) - 0 to 0.5
      cards.forEach((card, index) => {
        const stackOffset = -(index * cardSlotWidth) + (index * 12)

        tl.to(
          card,
          {
            y: 0,
            x: stackOffset,
            duration: 0.5,
            ease: 'power2.out',
          },
          index * 0.02 // Slight stagger
        )
      })

      // Phase 2: Cards spread out to original positions - 0.5 to 1
      cards.forEach((card, index) => {
        tl.to(
          card,
          {
            x: 0,
            rotateZ: 0,
            scale: 1,
            zIndex: 1,
            duration: 0.5,
            ease: 'power3.out',
          },
          0.5 + (index * 0.03)
        )
      })
    }, containerRef)

    return () => ctx.revert()
  }, [])

  // CTA Section animations
  useEffect(() => {
    const ctaHeading = ctaHeadingRef.current
    const ctaContent = ctaContentRef.current
    const ctaSection = ctaSectionRef.current
    if (!ctaHeading || !ctaContent || !ctaSection) return

    const ctx = gsap.context(() => {
      // Heading animation - fade up
      gsap.fromTo(
        ctaHeading,
        {
          y: 80,
          opacity: 0,
        },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: ctaSection,
            start: 'top 70%',
            toggleActions: 'play none none reverse',
          },
        }
      )

      // Content (paragraph + button) animation - fade up with delay
      gsap.fromTo(
        ctaContent.children,
        {
          y: 40,
          opacity: 0,
        },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power3.out',
          stagger: 0.15,
          scrollTrigger: {
            trigger: ctaSection,
            start: 'top 60%',
            toggleActions: 'play none none reverse',
          },
        }
      )
    }, containerRef)

    return () => ctx.revert()
  }, [])

  // Footer animations
  useEffect(() => {
    const footer = footerRef.current
    const newsletterCard = newsletterCardRef.current
    const footerLinks = footerLinksRef.current
    if (!footer || !newsletterCard || !footerLinks) return

    const ctx = gsap.context(() => {
      // Newsletter card - slide up and fade in
      gsap.fromTo(
        newsletterCard,
        {
          y: 60,
          opacity: 0,
        },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: newsletterCard,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        }
      )

      // Footer links - staggered fade in
      gsap.fromTo(
        footerLinks.children,
        {
          y: 30,
          opacity: 0,
        },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          ease: 'power2.out',
          stagger: 0.1,
          scrollTrigger: {
            trigger: footerLinks,
            start: 'top 90%',
            toggleActions: 'play none none reverse',
          },
        }
      )
    }, containerRef)

    return () => ctx.revert()
  }, [])

  if (connected) {
    navigate('/dashboard')
    return null
  }

  return (
    <div ref={containerRef} className="bg-[#000000] overflow-x-hidden selection:bg-kage-accent/30">
      <Header />

      {/* Hero Section - Pinned during scroll */}
      <div ref={heroSectionRef} className="relative min-h-screen flex flex-col overflow-hidden">
        {/* Content - Fades out on scroll */}
        <div
          ref={heroContentRef}
          className="absolute inset-0 flex flex-col items-center justify-center pb-8 px-4 sm:px-6 lg:px-8 z-10"
        >
          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="text-2xl text-kage-text-muted font-light mb-6"
          >
            The crypto payroll app for everyone.
          </motion.p>

          {/* Main Headline */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <h1 className="text-[150px] font-semibold tracking-tight text-white leading-[1.1]">
              The
              <motion.div
                aria-label="Kage"
                className="inline-block align-middle mx-3 sm:mx-5 w-16 h-16 sm:w-24 sm:h-24 md:w-32 md:h-32 -mt-2 shimmer-img"
                style={{
                  '--shimmer-mask': `url(${shadowImg})`,
                  '--shimmer-bg': `url(${shadowImg})`,
                } as React.CSSProperties}
              />
              <span className="text-[150px] text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-white/70">
                Privacy
              </span>
              <br />
              <span className="text-[150px] text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-white/70">
                Layer
              </span>
            </h1>
          </motion.div>

          {/* CTA Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mt-12"
          >
            <button className="group relative p-7 mt-4 rounded-full bg-[#181818] text-kage-text font-medium text-xl cursor-pointer transition-all duration-300 ease-out hover:bg-kage-accent hover:scale-[0.98]">
              Get Started
            </button>
          </motion.div>
        </div>

        {/* Globe Wrapper - Rises up in front of text */}
        <div
          ref={globeWrapperRef}
          className="absolute bottom-0 left-0 right-0 h-[60vh] z-20"
        >

          <div className="absolute inset-0" /> 
          {/* Globe container - positioned to show only top half */}
          <div
            ref={globeContainerRef}
            className="absolute left-1/2 top-0 w-[120vw] max-w-[1400px]"
          >
            <Globe className="w-full" />
          </div>
        </div>
      </div>

      {/* Second Section - Cards with CTA reveal */}
      <div ref={secondSectionRef} className="min-h-screen flex flex-col items-center pt-24 px-4 sm:px-6 lg:px-8 bg-[#000000] relative">
        <h2 className="second-section-title text-[60px] md:text-[80px] font-semibold tracking-tight text-kage-muted leading-[1.1] text-center relative z-20">
          Keep everything
          <br />
          in
          <span className="inline-block align-middle mx-3 sm:mx-5 w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 -mt-2"
            style={{
              backgroundImage: `url(${shadowImg})`,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
            }}
          />
          one place
        </h2>

        {/* Feature Cards Navigation */}
        <div className="w-full max-w-7xl mt-12 flex items-center justify-between px-4 relative z-20">
          <button className="flex items-center gap-2 px-4 py-3 rounded-full bg-kage-surface text-kage-text text-sm font-medium  transition-colors">
            Your Privacy
          </button>
          <div className="flex items-center gap-2 bg-kage-surface rounded-full px-1 py-1">
            <button 
              onClick={() => scrollCarousel('left')}
              className={`w-9 h-9 rounded-full bg-kage-text-muted flex items-center justify-center hover:bg-kage-text transition-all duration-200 ${
                canScrollLeft ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'
              }`}
            >
              <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button 
              onClick={() => scrollCarousel('right')}
              className={`w-9 h-9 rounded-full bg-kage-text-muted flex items-center justify-center hover:bg-kage-text transition-all duration-200 ${
                canScrollRight ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'
              }`}
            >
              <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Feature Cards Carousel */}
        <div ref={carouselWrapperRef} className="w-full max-w-7xl mt-8 relative z-20" style={{ perspective: '1000px' }}>
          <div ref={carouselRef} className="overflow-x-auto scrollbar-hide scroll-smooth" style={{ transformStyle: 'preserve-3d' }}>
            <div className="flex gap-5 px-4 pb-8">
              {/* Card 1 - Privacy Payments */}
              <div ref={el => { cardRefs.current[0] = el }} className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-[#181818] p-6 flex flex-col flex-shrink-0">
              <h3 className="text-kage-muted text-2xl font-semibold leading-tight">
                Confidential payments. Complete privacy.
              </h3>
              <div className="flex-1 flex items-end justify-center mt-4">
                <div className="w-[320px] h-[380px] bg-[#1d1d1f] rounded-3xl p-6 shadow-xl">
                  <div className="flex items-center gap-2 mb-6">
                    <span className="text-kage-muted text-lg font-medium">Kage Payroll</span>
                  </div>
                  <div className="space-y-5">
                    <div className="bg-[#2d2d2f] rounded-xl p-5">
                      <p className="text-gray-400 text-base">Balance Hidden</p>
                      <p className="text-kage-secondary text-2xl font-semibold">*****</p>
                    </div>
                    <div className="bg-[#2d2d2f] rounded-xl p-5">
                      <p className="text-gray-400 text-base">Last Payment</p>
                      <p className="text-kage-secondary text-lg">Encrypted</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

              {/* Card 2 - ZK Proofs */}
              <div ref={el => { cardRefs.current[1] = el }} className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-[#5CB8E4]/70 p-6 flex flex-col flex-shrink-0">
              <h3 className="text-white text-2xl font-semibold leading-tight">
                Zero-knowledge proofs for every transaction.
              </h3>
              <div className="flex-1 flex items-center justify-center mt-4">
                <div className="grid grid-cols-3 gap-5">
                  <div className="w-20 h-20 rounded-2xl bg-[#181818] flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div className="w-20 h-20 rounded-2xl bg-[#181818] flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div className="w-20 h-20 rounded-2xl bg-[#181818] flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <div className="w-20 h-20 rounded-2xl bg-[#181818] flex items-center justify-center">
                    <span className="text-kage-accent font-bold text-xl">ZK</span>
                  </div>
                  <div className="w-20 h-20 rounded-2xl bg-[#181818] flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="w-20 h-20 rounded-2xl bg-[#181818] flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

              {/* Card 3 - Vesting Schedules */}
              <div ref={el => { cardRefs.current[2] = el }} className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-kage-accent/70 p-6 flex flex-col flex-shrink-0">
              <h3 className="text-white text-2xl font-semibold leading-tight">
                Private vesting schedules for your team.
              </h3>
              <div className="flex-1 flex items-end justify-center mt-4">
                <div className="w-[320px] h-[360px] bg-[#1d1d1f] rounded-3xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-white text-lg">Vesting #7105</span>
                  </div>
                  <div className="w-full h-48 bg-kage-secondary/70 rounded-2xl flex items-center justify-center">
                    <svg className="w-24 h-24 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex gap-4 mt-4">
                    <button className="flex-1 py-4 bg-[#2d2d2f] rounded-xl text-white text-lg">Claim</button>
                    <button className="flex-1 py-4 bg-[#2d2d2f] rounded-xl text-white text-lg">View</button>
                  </div>
                </div>
              </div>
            </div>

              {/* Card 4 - Transaction History */}
              <div ref={el => { cardRefs.current[3] = el }} className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-kage-text p-6 flex flex-col flex-shrink-0 overflow-hidden">
              <h3 className="text-[#1d1d1f] text-2xl font-semibold leading-tight">
                Monitor activity with encrypted history.
              </h3>
              <div className="flex-1 flex items-start justify-center mt-4 relative overflow-hidden">
                <AnimatedList delay={2000} className="w-full mt-8">
                  <figure className="relative mx-auto w-full overflow-hidden rounded-2xl p-4 bg-white shadow-sm transition-all duration-200 ease-in-out">
                    <div className="flex flex-row items-center gap-3">
                      <div className="flex flex-col overflow-hidden flex-1">
                        <figcaption className="flex flex-row items-center text-lg font-medium whitespace-pre text-[#1d1d1f]">
                          <span className="text-sm sm:text-base">Salary Payment</span>
                          <span className="mx-1">·</span>
                          <span className="text-xs text-gray-500">15m ago</span>
                        </figcaption>
                        <p className="text-sm font-normal text-gray-500">Encrypted</p>
                      </div>
                      <p className="text-kage-accent text-base font-medium">+*** SOL</p>
                    </div>
                  </figure>
                  <figure className="relative mx-auto w-full overflow-hidden rounded-2xl p-4 bg-white shadow-sm transition-all duration-200 ease-in-out">
                    <div className="flex flex-row items-center gap-3">
                      <div className="flex flex-col overflow-hidden flex-1">
                        <figcaption className="flex flex-row items-center text-lg font-medium whitespace-pre text-[#1d1d1f]">
                          <span className="text-sm sm:text-base">Vesting Claim</span>
                          <span className="mx-1">·</span>
                          <span className="text-xs text-gray-500">10m ago</span>
                        </figcaption>
                        <p className="text-sm font-normal text-gray-500">Private</p>
                      </div>
                      <p className="text-kage-accent text-base font-medium">+*** USDC</p>
                    </div>
                  </figure>
                  <figure className="relative mx-auto w-full overflow-hidden rounded-2xl p-4 bg-white shadow-sm transition-all duration-200 ease-in-out">
                    <div className="flex flex-row items-center gap-3">
                      <div className="flex flex-col overflow-hidden flex-1">
                        <figcaption className="flex flex-row items-center text-lg font-medium whitespace-pre text-[#1d1d1f]">
                          <span className="text-sm sm:text-base">ZK Transfer</span>
                          <span className="mx-1">·</span>
                          <span className="text-xs text-gray-500">5m ago</span>
                        </figcaption>
                        <p className="text-sm font-normal text-gray-500">Shielded</p>
                      </div>
                      <p className="text-kage-accent text-base font-medium">+*** SOL</p>
                    </div>
                  </figure>
                  <figure className="relative mx-auto w-full overflow-hidden rounded-2xl p-4 bg-white shadow-sm transition-all duration-200 ease-in-out">
                    <div className="flex flex-row items-center gap-3">
                      <div className="flex flex-col overflow-hidden flex-1">
                        <figcaption className="flex flex-row items-center text-lg font-medium whitespace-pre text-[#1d1d1f]">
                          <span className="text-sm sm:text-base">Token Deposit</span>
                          <span className="mx-1">·</span>
                          <span className="text-xs text-gray-500">2m ago</span>
                        </figcaption>
                        <p className="text-sm font-normal text-gray-500">Hidden</p>
                      </div>
                      <p className="text-kage-accent text-base font-medium">+*** SOL</p>
                    </div>
                  </figure>
                </AnimatedList>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-kage-text to-transparent"></div>
              </div>
            </div>

              {/* Card 5 - Light Protocol */}
              <div ref={el => { cardRefs.current[4] = el }} className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-kage-secondary-dim p-6 flex flex-col flex-shrink-0">
                <h3 className="text-white text-2xl font-semibold leading-tight">
                  Built on Solana, Light Protocol, Arcium and Noir.
                </h3>
                <div className="flex-1 flex items-center justify-center mt-4">
                  <div className="relative flex h-[280px] w-[280px] flex-col items-center justify-center overflow-hidden">
                    {/* Outer Orbit - Solana */}
                    <OrbitingCircles iconSize={52} radius={110} duration={25}>
                      <img src={solanaIcon} alt="Solana" className="w-12 h-12" />
                      <img src={solanaIcon} alt="Solana" className="w-12 h-12" />
                      <img src={solanaIcon} alt="Solana" className="w-12 h-12" />
                      <img src={solanaIcon} alt="Solana" className="w-12 h-12" />
                    </OrbitingCircles>

                    {/* Inner Orbit - Arcium, Light, Noir */}
                    <OrbitingCircles iconSize={48} radius={60} reverse speed={1.5} duration={20}>
                      <img src={arciumIcon} alt="Arcium" className="w-14 h-14" />
                      <img src={lightIcon} alt="Light Protocol" className="w-14 h-14" />
                      <img src={noirIcon} alt="Noir" className="w-14 h-14" />
                    </OrbitingCircles>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div
        ref={ctaSectionRef}
        className="min-h-screen flex flex-col items-center justify-center bg-[#000000] px-4 relative overflow-hidden"
      >
        <h2
          ref={ctaHeadingRef}
          className="text-[60px] md:text-[80px] font-semibold tracking-tight text-white leading-[1.1] text-center mb-4"
        >
          Powerful
          <span
            className="inline-block align-middle mx-3 sm:mx-5 w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 -mt-2"
            style={{
              backgroundImage: `url(${shadowImg})`,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
            }}
          />
          apps
          <br />
          made for everyone
        </h2>
        <div ref={ctaContentRef} className="flex flex-col items-center">
          <p className="text-xl text-white/70 text-center">
            Trusted by teams who value privacy and security
          </p>
          <button className="group relative p-7 rounded-full bg-[#181818] text-kage-text font-medium text-xl cursor-pointer transition-all duration-300 ease-out hover:bg-kage-accent hover:scale-[0.98] mt-16">
            Launch App
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer ref={footerRef} className="bg-[#000000] px-4 sm:px-6 lg:px-8 py-16 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          {/* Newsletter Card */}
          <div ref={newsletterCardRef} className="bg-[#1d1d1f] rounded-3xl p-8 md:p-12 mb-16">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
              {/* Logo */}
              <div className="flex-shrink-0">
                <span
                  className="inline-block w-20 h-20 mb-20"
                  style={{
                    backgroundImage: `url(${shadowImg})`,
                    backgroundSize: 'contain',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center',
                  }}
                />
              </div>
              
              {/* Newsletter Form */}
              <div className="flex-1 max-w-xl">
                <h3 className="text-3xl md:text-4xl font-semibold text-white mb-3">
                  Enter your email
                </h3>
                <p className="text-white/60 mb-6">
                  Sign up for our newsletter and join the growing Kage community.
                </p>
                <div className="flex gap-3">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    className="flex-1 px-5 py-3 bg-[#2d2d2f] rounded-full text-white placeholder:text-white/40 focus:outline-none transition-colors"
                  />
                  <button className="px-6 py-3 bg-white text-[#1d1d1f] font-medium rounded-full hover:bg-kage-accent hover:text-white cursor-pointer transition-colors">
                    Sign up
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Links */}
            <div ref={footerLinksRef} className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-12 pt-12 border-t border-white/10">
              {/* Product */}
              <div>
                <h4 className="text-white/50 text-sm font-medium mb-4">Product</h4>
                <ul className="space-y-3">
                  <li><Link to="/dashboard" className="text-white hover:text-kage-accent transition-colors">Dashboard</Link></li>
                  <li><Link to="/organizations" className="text-white hover:text-kage-accent transition-colors">Organizations</Link></li>
                  <li><Link to="/positions" className="text-white hover:text-kage-accent transition-colors">Positions</Link></li>
                  <li><Link to="/claim" className="text-white hover:text-kage-accent transition-colors">Claim</Link></li>
                </ul>
              </div>

              {/* Resources */}
              <div>
                <h4 className="text-white/50 text-sm font-medium mb-4">Resources</h4>
                <ul className="space-y-3">
                  <li><a href="https://docs.kage.finance" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors">Docs</a></li>
                  <li><a href="https://blog.kage.finance" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors">Blog</a></li>
                  <li><a href="https://github.com/kage-finance/changelog" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors">Changelog</a></li>
                  <li><a href="mailto:support@kage.finance" className="text-white hover:text-kage-accent transition-colors">Support</a></li>
                </ul>
              </div>

              {/* Company */}
              <div>
                <h4 className="text-white/50 text-sm font-medium mb-4">Company</h4>
                <ul className="space-y-3">
                  <li><a href="#about" className="text-white hover:text-kage-accent transition-colors">About</a></li>
                  <li><a href="https://jobs.kage.finance" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors">Careers</a></li>
                  <li><a href="https://kage.finance/press" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors">Press Kit</a></li>
                </ul>
              </div>

              {/* Socials */}
              <div>
                <h4 className="text-white/50 text-sm font-medium mb-4">Socials</h4>
                <ul className="space-y-3">
                  <li><a href="https://x.com/kaborasolutions" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors flex items-center gap-2">𝕏 X.com</a></li>
                  <li><a href="https://youtube.com/@kagefinance" target="_blank" rel="noopener noreferrer" className="text-white hover:text-kage-accent transition-colors flex items-center gap-2"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>YouTube</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

