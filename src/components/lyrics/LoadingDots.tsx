import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface LoadingDotsProps {
  className?: string;
  label?: string;
}

export function LoadingDots({ className, label = "Finding lyrics" }: LoadingDotsProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-2 w-2 rounded-full bg-white/80"
            animate={{
              y: [0, -7, 0],
              opacity: [0.28, 1, 0.28],
              scale: [0.85, 1.08, 0.85],
            }}
            transition={{
              duration: 1.05,
              repeat: Infinity,
              ease: "easeInOut",
              delay: index * 0.14,
            }}
          />
        ))}
      </div>
      <motion.p
        className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/30"
        animate={{ opacity: [0.4, 0.85, 0.4] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        {label}
      </motion.p>
    </div>
  );
}
