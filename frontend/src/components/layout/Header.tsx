import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
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
  const location = useLocation();

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
                <span className="px-4 py-2 rounded-full text-base font-medium text-kage-text-muted  hover:bg-kage-accent/30 cursor-pointer transition-all duration-200">
                  Features
                </span>
                <span className="px-4 py-2 rounded-full text-base font-medium text-kage-text-muted  hover:bg-kage-accent/30 cursor-pointer transition-all duration-200">
                  About
                </span>
                <span className="px-4 py-2 rounded-full text-base font-medium text-kage-text-muted hover:bg-kage-accent/30 cursor-pointer transition-all duration-200">
                  Docs
                </span>
              </>
            )}
          </motion.nav>

          {/* Right - Search + Wallet Button (no container) */}
          <div className="flex items-center gap-4">
            {/* Search */}
            <button className="p-2 text-kage-text-muted hover:text-kage-text transition-colors">
              <Search className="w-5 h-5" />
            </button>

            {/* Wallet Button */}
            <WalletMultiButton />
          </div>
        </div>
      </div>
    </header>
  );
};
