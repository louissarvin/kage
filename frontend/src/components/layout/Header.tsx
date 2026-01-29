import type { FC } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import logoImg from "@/assets/logo.png";

const navItems = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/organizations", label: "Organizations" },
  { path: "/positions", label: "Positions" },
  { path: "/claim", label: "Claim" },
];

export const Header: FC = () => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const location = useLocation();
  const navigate = useNavigate();

  // Check if on landing page
  const isLandingPage = location.pathname === '/';

  const handleButtonClick = () => {
    if (isLandingPage) {
      // On landing page: go to dashboard
      navigate('/dashboard');
    } else {
      // On other pages: open wallet modal
      setVisible(true);
    }
  };

  return (
    <header className="fixed top-4 left-0 right-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Left - Logo (no container) */}
          <Link to="/" className="shrink-0">
            <img
              src={logoImg}
              alt="Kage"
              className="h-20 w-auto transition-transform"
            />
          </Link>

          {/* Center - Nav Links in Pill Container */}
          <motion.nav
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="hidden md:flex items-center gap-2 px-2 py-2 rounded-full bg-[#181818] backdrop-blur-md"
          >
            {connected ? (
              navItems.map((item) => {
                const isActive = location.pathname === item.path;

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`
                      relative flex items-center gap-2 px-4 py-2 rounded-full
                      text-base font-medium transition-all duration-200
                      ${
                        isActive
                          ? "text-kage-text bg-kage-accent/30"
                          : "text-kage-text-muted hover:bg-kage-accent/30"
                      }
                    `}
                  >
                    {item.label}
                  </Link>
                );
              })
            ) : (
              <>
                <a
                  href="#features"
                  className="px-4 py-2 rounded-full text-base font-medium text-kage-text-muted hover:bg-kage-accent/30 cursor-pointer transition-all duration-200"
                >
                  Features
                </a>
                <a
                  href="#about"
                  className="px-4 py-2 rounded-full text-base font-medium text-kage-text-muted hover:bg-kage-accent/30 cursor-pointer transition-all duration-200"
                >
                  About
                </a>
                <a
                  href="https://docs.kage.finance"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-full text-base font-medium text-kage-text-muted hover:bg-kage-accent/30 cursor-pointer transition-all duration-200"
                >
                  Docs
                </a>
              </>
            )}
          </motion.nav>

          {/* Right - Search + Launch App Button */}
          <div className="flex items-center gap-4">
            {/* Search */}
            <button className="p-2 text-kage-text-muted hover:text-kage-text transition-colors">
              <Search className="w-5 h-5" />
            </button>

            {/* Dynamic Button */}
            <button
              onClick={handleButtonClick}
              className="px-6 py-3 bg-kage-accent text-white font-medium rounded-full hover:bg-kage-accent-dim transition-all duration-200 hover:scale-[0.98]"
            >
              {isLandingPage ? 'Launch App' : 'Select Wallet'}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
