import { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { WaitlistModal } from "@/components/WaitlistModal";
import { ContactModal } from "@/components/ContactModal";
import { Toaster } from "sonner";
import { Hero } from "@/sections/Hero";
import { Features } from "@/sections/Features";
import { HowItWorks } from "@/sections/HowItWorks";
import { AgentPackage } from "@/sections/AgentPackage";
import { Testimonials } from "@/sections/Testimonials";
import { Pricing } from "@/sections/Pricing";
import { Team } from "@/sections/Team";
import { FAQ } from "@/sections/FAQ";
import { Footer } from "@/sections/Footer";

export default function Home() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | undefined>();

  const openWaitlist = (plan?: string) => {
    setSelectedPlan(plan);
    setWaitlistOpen(true);
  };

  return (
    <div className="min-h-screen bg-crew-bg">
      <Navigation onGetStarted={() => openWaitlist()} />
      <main>
        <Hero onGetStarted={() => openWaitlist()} />
        <Features />
        <HowItWorks />
        <AgentPackage />
        <Testimonials />
        <Pricing onGetStarted={openWaitlist} onContact={() => setContactOpen(true)} />
        <Team />
        <FAQ />
      </main>
      <Footer onGetStarted={() => openWaitlist()} />
      <WaitlistModal open={waitlistOpen} onClose={() => setWaitlistOpen(false)} defaultPlan={selectedPlan} />
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "#141210",
            border: "1px solid #2A2725",
            color: "#E8E4E0",
          },
        }}
      />
    </div>
  );
}
