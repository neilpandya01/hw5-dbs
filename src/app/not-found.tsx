import { ButtonLink } from "@/components/Button";
import { EmptyState } from "@/components/Page";

export default function NotFound() {
  return (
    <EmptyState title="There's no page here.">
      <ButtonLink href="/">Back to the radar</ButtonLink>
    </EmptyState>
  );
}
