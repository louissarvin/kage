import { type FC, useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { formatAddress } from "@/lib/constants";

const navItems = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/organizations", label: "Organizations" },
  { path: "/positions", label: "Positions" },
  { path: "/claim", label: "Claim" },
];

export const Header: FC = () => {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const location = useLocation();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check if on landing page
  const isLandingPage = location.pathname === '/';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleButtonClick = () => {
    if (isLandingPage) {
      navigate('/dashboard');
    } else if (connected) {
      setShowDropdown(!showDropdown);
    } else {
      setVisible(true);
    }
  };

  const handleCopyAddress = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setShowDropdown(false);
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
          <nav className="hidden md:flex items-center gap-2 px-2 py-2 rounded-full bg-[#181818] backdrop-blur-md">
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
          </nav>

          {/* Right - Search + Wallet Button */}
          <div className="flex items-center gap-4">
            {/* Search */}
            <button className="p-2 text-kage-text-muted hover:text-kage-text transition-colors">
              <Search className="w-5 h-5" />
            </button>

            {/* Wallet Button with Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={handleButtonClick}
                className="px-6 py-3 bg-kage-accent text-white font-medium rounded-full hover:bg-kage-accent-dim transition-all duration-200 hover:scale-[0.98]"
              >
                {isLandingPage
                  ? 'Launch App'
                  : connected && publicKey
                    ? formatAddress(publicKey.toBase58(), 4)
                    : 'Select Wallet'
                }
              </button>

              {/* Dropdown Menu */}
              <AnimatePresence>
                {showDropdown && connected && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-3 w-36 bg-[#181818] rounded-xl"
                  >
                    <button
                      onClick={handleCopyAddress}
                      className="w-full flex items-center px-4 py-2.5 text-sm text-kage-text-muted hover:text-kage-text rounded-t-xl hover:bg-kage-subtle transition-colors"
                    >
                      {copied ? 'Copied!' : 'Copy Address'}
                    </button>
                    <button
                      onClick={handleDisconnect}
                      className="w-full flex items-center px-4 py-2.5 text-sm text-red-400 rounded-b-xl hover:bg-kage-subtle transition-colors"
                    >
                      Disconnect
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
