import { useState } from "react";
import { PageHeader, PageBody, FilterGroup, Tabs } from "../components/ui";
import CostsReport from "./reports/CostsReport";
import KnowledgeReport from "./reports/KnowledgeReport";
import CronReport from "./reports/CronReport";
import ConversationsReport from "./reports/ConversationsReport";
import SystemReport from "./reports/SystemReport";

const TIME_RANGES = [7, 30, 90] as const;

export default function Reports() {
  const [days, setDays] = useState<number>(30);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Analytics and cost tracking"
      />
      <PageBody>
        <div className="list-page-toolbar">
          <FilterGroup
            options={TIME_RANGES}
            value={days}
            onChange={(v) => setDays(Number(v))}
            labelFn={(d) => `${d}d`}
          />
        </div>
        <Tabs
          defaultValue="costs"
          tabs={[
            { value: "costs", label: "Costs", content: <CostsReport days={days} /> },
            { value: "knowledge", label: "Knowledge", content: <KnowledgeReport days={days} /> },
            { value: "cron", label: "Cron", content: <CronReport days={days} /> },
            { value: "conversations", label: "Conversations", content: <ConversationsReport days={days} /> },
            { value: "system", label: "System", content: <SystemReport /> },
          ]}
        />
      </PageBody>
    </>
  );
}
