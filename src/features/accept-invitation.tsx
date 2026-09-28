"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";

export function AcceptInvitationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <FormError error={error} />
      <Button
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const { home } = await api<{ home: string }>(`/api/v1/invitations/${id}/accept`, { method: "POST", body: {} });
            router.push(home);
            router.refresh();
          } catch (e) {
            setError(errorMessage(e));
            setPending(false);
          }
        }}
      >
        {t("invitation.accept")}
      </Button>
    </div>
  );
}
