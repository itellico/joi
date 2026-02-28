import { PageBody, PageHeader } from "../components/ui";
import HumanizerTab from "./settings/HumanizerTab";

export default function Humanizer() {
  return (
    <>
      <PageHeader title="Humanizer" />
      <PageBody>
        <HumanizerTab />
      </PageBody>
    </>
  );
}
