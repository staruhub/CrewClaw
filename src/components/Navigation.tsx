import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { CrewClawMark } from "@/components/BrandAssets";

interface NavigationProps {
  onGetStarted: () => void;
}

const navLinks = [
  { label: "Certified", href: "#why" },
  { label: "Install Flow", href: "#how-it-works" },
  { label: "Expert Crew", href: "#market" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export function Navigation({ onGetStarted }: NavigationProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (href: string) => {
    const el = document.querySelector(href);
    if (el) {
      const offset = 80;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
    setMobileOpen(false);
  };

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-[1000] h-20 transition-all duration-500 ${
          scrolled
            ? "bg-[#0B0908]/88 backdrop-blur-xl border-b border-crew-border/70"
            : "bg-transparent"
        }`}
      >
        <div className="site-container flex h-full items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <CrewClawMark className="h-9 w-9 shrink-0" />
            <div className="flex items-baseline gap-1">
              <span className="font-sans text-[26px] font-light text-crew-heading">
                CrewClaw
              </span>
              <span className="font-sans text-[26px] font-light text-crew-copper">
                .
              </span>
            </div>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-7">
            {navLinks.map(link => (
              <button
                key={link.href}
                onClick={() => scrollTo(link.href)}
                className="font-sans text-[13px] text-crew-body hover:text-crew-heading transition-colors duration-300"
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:block">
            <button
              onClick={onGetStarted}
              className="border border-white/10 bg-white/[0.04] text-crew-heading font-sans text-[13px] px-5 py-2.5 rounded-sm hover:border-crew-copper/40 hover:bg-white/[0.06] transition-all"
            >
              Hire an expert
            </button>
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden text-crew-heading"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={
              mobileOpen ? "Close navigation menu" : "Open navigation menu"
            }
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden bg-[#0B0908]/95 backdrop-blur-xl border-b border-crew-border/70 px-6 pb-6 pt-2">
            <div className="flex flex-col gap-4">
              {navLinks.map(link => (
                <button
                  key={link.href}
                  onClick={() => scrollTo(link.href)}
                  className="font-sans text-sm text-crew-body hover:text-crew-heading transition-colors text-left"
                >
                  {link.label}
                </button>
              ))}
              <button
                onClick={() => {
                  onGetStarted();
                  setMobileOpen(false);
                }}
                className="border border-white/10 bg-white/[0.04] text-crew-heading font-sans text-sm px-6 py-2.5 rounded-sm hover:border-crew-copper/40 hover:bg-white/[0.06] transition-all w-full mt-2"
              >
                Hire an expert
              </button>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
