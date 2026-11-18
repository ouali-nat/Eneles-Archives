"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { HeroGrid } from "@/components/essential/shaders/HeroGrid";
import { HeroPreview } from "./HeroPreview";
import { EASE_OUT } from "./_shared";

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: EASE_OUT },
  }),
};

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Ruled paper whose cells light under the pointer. The shader itself stays quiet behind the headline and fades toward the edges. */}
      <HeroGrid className="-z-10 [mask-image:linear-gradient(to_bottom,black_72%,transparent)]" />

      <div className="container relative pt-36 pb-20 @min-[40rem]:pt-48 @min-[40rem]:pb-28">
        <div className="flex flex-col items-center text-center">
          <motion.h1
            custom={0}
            variants={rise}
            initial="hidden"
            animate="visible"
            className="text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.04em] text-balance @min-[40rem]:text-[4rem] @5xl:text-[4.75rem]"
          >
            The whole paper, in one place.
          </motion.h1>

          <motion.p
            custom={1}
            variants={rise}
            initial="hidden"
            animate="visible"
            className="mt-6 max-w-5xl text-lg leading-relaxed text-muted-foreground text-pretty @min-[40rem]:text-xl"
          >
            Handwriting to LaTeX, real-time collaboration, a TikZ library, an AI assistant, and GitHub sync.
          </motion.p>

          <motion.div
            custom={2}
            variants={rise}
            initial="hidden"
            animate="visible"
            className="mt-10 flex w-full flex-col gap-3 @min-[40rem]:w-auto @min-[40rem]:flex-row"
          >
            <Button asChild size="lg">
              <Link href="/signup">
                Start writing
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="bg-background/60 backdrop-blur-sm">
              <Link href="/features">Try the features</Link>
            </Button>
          </motion.div>
        </div>

        {/* The product itself, under the invitation to use it: a little wider than the page column where the window has room, so its panels are not cramped. */}
        <motion.div custom={3} variants={rise} initial="hidden" animate="visible" className="mx-auto mt-16 max-w-6xl @min-[40rem]:mt-20 @min-[84rem]:-mx-12 @min-[84rem]:max-w-none">
          <HeroPreview />
        </motion.div>
      </div>
    </section>
  );
}
