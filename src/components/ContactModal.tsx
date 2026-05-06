import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { X } from "lucide-react";

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

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    submit.mutate({ name: name.trim(), email: email.trim(), message: message.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-crew-card border border-crew-border rounded-xl p-8 w-full max-w-md">
        <button onClick={onClose} className="absolute top-4 right-4 text-crew-muted hover:text-crew-heading transition-colors">
          <X size={20} />
        </button>
        <h3 className="font-mono text-xl font-bold text-crew-heading mb-2">Contact Us</h3>
        <p className="text-crew-body text-sm mb-6">Tell us about your enterprise needs.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-crew-muted mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-crew-bg border border-crew-border rounded-lg px-4 py-3 text-crew-heading text-sm focus:outline-none focus:border-crew-copper transition-colors"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-crew-muted mb-1.5">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-crew-bg border border-crew-border rounded-lg px-4 py-3 text-crew-heading text-sm focus:outline-none focus:border-crew-copper transition-colors"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-crew-muted mb-1.5">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full bg-crew-bg border border-crew-border rounded-lg px-4 py-3 text-crew-heading text-sm focus:outline-none focus:border-crew-blue transition-colors resize-none"
              placeholder="How can we help?"
            />
          </div>
          <button
            type="submit"
            disabled={submit.isPending}
            className="w-full bg-gradient-to-r from-crew-copper to-crew-bronze text-white font-mono font-semibold py-3 rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
          >
            {submit.isPending ? "Sending..." : "Send Message"}
          </button>
        </form>
      </div>
    </div>
  );
}
