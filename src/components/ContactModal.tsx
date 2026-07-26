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

interface ContactModalProps {
  open: boolean;
  onClose: () => void;
}

export function ContactModal({ open, onClose }: ContactModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const submit = trpc.contact.submit.useMutation({
    onSuccess: () => {
      toast.success("Message sent! We'll get back to you soon.");
      setName("");
      setEmail("");
      setMessage("");
      onClose();
    },
    onError: () => {
      toast.error("Failed to send. Please try again.");
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    submit.mutate({
      name: name.trim(),
      email: email.trim(),
      message: message.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
      <DialogContent className="w-full max-w-md gap-0 border-crew-border bg-crew-card p-8">
        <DialogHeader className="gap-2 text-left">
          <DialogTitle className="font-mono text-xl font-bold text-crew-heading">
            Contact Us
          </DialogTitle>
          <DialogDescription className="text-sm text-crew-body">
            Tell us about your enterprise needs.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          aria-busy={submit.isPending}
          className="mt-6 space-y-4"
        >
          <div>
            <label
              htmlFor="contact-name"
              className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-crew-muted"
            >
              Name *
            </label>
            <input
              id="contact-name"
              name="name"
              autoComplete="name"
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              required
              className="w-full rounded-lg border border-crew-border bg-crew-bg px-4 py-3 text-sm text-crew-heading transition-colors focus:border-crew-copper focus:outline-none"
              placeholder="Your name"
            />
          </div>
          <div>
            <label
              htmlFor="contact-email"
              className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-crew-muted"
            >
              Email *
            </label>
            <input
              id="contact-email"
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
          <div>
            <label
              htmlFor="contact-message"
              className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-crew-muted"
            >
              Message
            </label>
            <textarea
              id="contact-message"
              name="message"
              autoComplete="off"
              value={message}
              onChange={event => setMessage(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-crew-border bg-crew-bg px-4 py-3 text-sm text-crew-heading transition-colors focus:border-crew-blue focus:outline-none"
              placeholder="How can we help?"
            />
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {submit.isPending ? "Sending message…" : ""}
          </p>
          <button
            type="submit"
            disabled={submit.isPending}
            className="w-full rounded-lg bg-gradient-to-r from-crew-copper to-crew-bronze py-3 font-mono font-semibold text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
          >
            {submit.isPending ? "Sending…" : "Send Message"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
