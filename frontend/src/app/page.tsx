import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import FeaturesGrid from "@/components/landing/FeaturesGrid";
import ShowcaseSection from "@/components/landing/ShowcaseSection";
import StatsSection from "@/components/landing/StatsSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import CTASplitSection from "@/components/landing/CTASplitSection";
import Footer from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <Hero />
      <FeaturesGrid />
      <ShowcaseSection />
      <StatsSection />
      <HowItWorksSection />
      <CTASplitSection />
      <Footer />
    </div>
  );
}
