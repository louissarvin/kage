import type { FC } from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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

      {/* Second Section - Fades in on scroll */}
      <div
        ref={secondSectionRef}
        className="min-h-screen flex flex-col items-center pt-24 px-4 sm:px-6 lg:px-8 bg-[#000000] relative overflow-hidden"
      >
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
        <div ref={carouselRef} className="w-full max-w-7xl mt-8 overflow-x-auto scrollbar-hide scroll-smooth relative z-20">
          <div className="flex gap-5 px-4 pb-8">
              {/* Card 1 - Privacy Payments */}
              <div className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-[#181818] p-6 flex flex-col flex-shrink-0">
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
              <div className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-[#5CB8E4]/70 p-6 flex flex-col flex-shrink-0">
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
              <div className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-kage-accent/70 p-6 flex flex-col flex-shrink-0">
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
              <div className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-kage-text p-6 flex flex-col flex-shrink-0 overflow-hidden">
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
              <div className="w-[360px] md:w-[400px] h-[480px] md:h-[520px] rounded-3xl bg-kage-secondary-dim p-6 flex flex-col flex-shrink-0">
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

      {/* CTA Section */}
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#000000] px-4">
        <h2 className="text-[60px] md:text-[80px] font-semibold tracking-tight text-white leading-[1.1] text-center mb-4">
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
          tools
          <br />
          made for everyone
        </h2>
        <p className="text-xl md:text-2xl text-white/70 text-center">
          Trusted by teams who value privacy and security
        </p>
        <button className="group relative p-7 rounded-full bg-[#181818] text-kage-text font-medium text-xl cursor-pointer transition-all duration-300 ease-out hover:bg-kage-accent hover:scale-[0.98] mt-16">
          Launch App
        </button>
      </div>
    </div>
  )
}

