import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WaitlistModalProps {
  open: boolean;
  onClose: () => void;
  defaultPlan?: string;
}

export function WaitlistModal({
  open,
  onClose,
  defaultPlan,
}: WaitlistModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const subscribe = trpc.waitlist.subscribe.useMutation({
    onSuccess: () => {
      toast.success("You're on the list! We'll be in touch soon.");
      setEmail("");
      setName("");
      onClose();
    },
    onError: () => {
      toast.error("Something went wrong. Please try again.");
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    subscribe.mutate({
      email: email.trim(),
      name: name.trim() || undefined,
      plan: defaultPlan,
    });
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
      <DialogContent className="w-full max-w-md gap-0 border-crew-border bg-crew-card p-8">
        <DialogHeader className="gap-2 text-left">
          <DialogTitle className="font-mono text-xl font-bold text-crew-heading">
            Join the Waitlist
          </DialogTitle>
          <DialogDescription className="text-sm text-crew-body">
            Be the first to hire AI agents for your team.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          aria-busy={subscribe.isPending}
          className="mt-6 space-y-4"
        >
          <div>
            <label
              htmlFor="waitlist-name"
              className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-crew-muted"
            >
              Name
            </label>
            <input
              id="waitlist-name"
              name="name"
              autoComplete="name"
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              className="w-full rounded-lg border border-crew-border bg-crew-bg px-4 py-3 text-sm text-crew-heading transition-colors focus:border-crew-copper focus:outline-none"
              placeholder="Your name"
            />
          </div>
          <div>
            <label
              htmlFor="waitlist-email"
              className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-crew-muted"
            >
              Email *
            </label>
            <input
              id="waitlist-email"
              name="email"
              autoComplete="email"
              spellCheck={false}
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
              className="w-full rounded-lg border border-crew-border bg-crew-bg px-4 py-3 text-sm text-crew-heading transition-colors focus:border-crew-copper focus:outline-none"
              placeholder="you@company.com"
            />
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {subscribe.isPending ? "Joining waitlist…" : ""}
          </p>
          <button
            type="submit"
            disabled={subscribe.isPending}
            className="w-full rounded-lg bg-gradient-to-r from-crew-copper to-crew-bronze py-3 font-mono font-semibold text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
          >
            {subscribe.isPending ? "Submitting…" : "Get Started — Free"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
