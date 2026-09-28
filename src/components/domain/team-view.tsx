import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import type { Actor } from "@/server/auth/roles";
import type { listMembers } from "@/server/modules/organizations";
import { CancelInvitationButton, InviteStaffForm, MemberRoleSelect, ReferralForm, RemoveMemberButton } from "@/features/team";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/layout";

/** Members and invitations of the active organization (customer or provider). */
export function TeamView({ actor, data }: { actor: Actor; data: Awaited<ReturnType<typeof listMembers>> }) {
  const isCustomer = actor.orgType === "CUSTOMER";
  const roles = isCustomer ? ["customer_owner", "customer_manager", "customer_viewer"] : ["provider_owner", "provider_dispatcher", "technician"];
  const owner = actor.role === (isCustomer ? "customer_owner" : "provider_owner");
  const inviteRoles = owner ? roles : actor.role === "provider_dispatcher" ? ["technician"] : [];
  const seats = data.members.length + data.invitations.length;
  const full = data.staffLimit !== null && seats >= data.staffLimit;
  return (
    <div className="space-y-6">
      <Table
        caption={t("team.members")}
        head={
          <tr>
            <Th>{t("team.name")}</Th>
            <Th>{t("team.role")}</Th>
            <Th>{t("team.since")}</Th>
            {owner ? <Th>{t("common.actions")}</Th> : null}
          </tr>
        }
      >
        {data.members.map((m) => (
          <tr key={m.id}>
            <Td>
              <span className="font-medium text-ink">{m.name}</span>
              {m.userId === actor.userId ? <Badge className="ml-2">{t("team.you")}</Badge> : null}
              <span className="block text-xs text-muted">{m.email}</span>
            </Td>
            <Td>{owner && m.userId !== actor.userId ? <MemberRoleSelect memberId={m.id} role={m.role} roles={roles} label={t("team.roleOf", { name: m.name })} /> : t(`roles.${m.role}`)}</Td>
            <Td className="whitespace-nowrap">{formatDate(m.createdAt)}</Td>
            {owner ? <Td>{m.userId !== actor.userId ? <RemoveMemberButton memberId={m.id} name={m.name} /> : null}</Td> : null}
          </tr>
        ))}
      </Table>

      {data.invitations.length ? (
        <Card>
          <CardHeader title={t("team.pendingInvitations")} />
          <CardBody>
            <ul className="divide-y divide-line">
              {data.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{i.email}</span> · {t(`roles.${i.role}`)}
                    <span className="block text-xs text-muted">{t("team.expires", { date: formatDate(i.expiresAt) })}</span>
                  </span>
                  {inviteRoles.includes(i.role) ? <CancelInvitationButton invitationId={i.id} /> : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {inviteRoles.length ? (
        <Card>
          <CardHeader
            title={t("team.inviteTitle")}
            description={data.staffLimit !== null ? t("team.seats", { used: seats, max: data.staffLimit }) : t("team.inviteIntro")}
          />
          <CardBody>
            <InviteStaffForm roles={inviteRoles} disabledReason={full ? t("team.full", { max: data.staffLimit ?? 0 }) : null} />
          </CardBody>
        </Card>
      ) : (
        <p className="text-sm text-muted">{t("team.ownerOnly")}</p>
      )}

      {isCustomer && actor.role !== "customer_viewer" ? (
        <Card>
          <CardHeader title={t("team.referral.title")} description={t("team.referral.intro")} />
          <CardBody>
            <ReferralForm />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
