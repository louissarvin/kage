import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { motion } from 'framer-motion'
import { Header } from '@/components/layout'
import { Globe } from '@/components/magicui/Globe'
import shadowImg from '@/assets/shadow.png'

export const Landing: FC = () => {
  const { connected } = useWallet()
  const navigate = useNavigate()

  if (connected) {
    navigate('/dashboard')
    return null
  }

  return (
    <div className="min-h-screen bg-[#000000] overflow-x-hidden selection:bg-kage-accent/30">
      <Header />

      {/* Hero Section - Full Height */}
      <div className="relative min-h-screen flex flex-col">
        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center pt-32 pb-8 px-4 sm:px-6 lg:px-8 mt-12">
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

        {/* Half Globe - Positioned at bottom */}
        <div className="relative w-full h-[50vh] overflow-hidden">
          {/* Gradient overlay to blend globe with background */}
          <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-transparent z-10 pointer-events-none" />

          {/* Globe container - positioned to show only top half */}
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 -translate-x-1/2 top-0 w-[120vw] max-w-[1400px]"
          >
            <Globe className="w-full" />
          </motion.div>
        </div>
      </div>
    </div>
  )
}

