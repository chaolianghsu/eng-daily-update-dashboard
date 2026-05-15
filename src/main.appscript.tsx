import { createRoot } from "react-dom/client";
import App from "./App";
import type { LoadData } from "./types";

const gsr = <T,>(fn: string): Promise<T> =>
  new Promise((resolve, reject) =>
    google.script.run
      .withSuccessHandler((s: string) => resolve(JSON.parse(s)))
      .withFailureHandler(reject)
      [fn]()
  );

const loadData: LoadData = async () => {
  const [raw, commits, tasks, planAnalysis] = await Promise.all([
    gsr<{ rawData: any; issues: any; leave: any; centers?: any }>("getDashboardData"),
    gsr<any>("getCommitData").catch(() => null),
    gsr<any>("getTaskAnalysisData").catch(() => null),
    gsr<any>("getPlanAnalysisData").catch(() => null),
  ]);
  return {
    rawData: raw.rawData,
    issues: raw.issues || [],
    leave: raw.leave || {},
    commitData: commits,
    taskAnalysisData: tasks,
    planAnalysisData: planAnalysis,
    centers: (raw as any).centers,
    parentCenters: (raw as any).parentCenters,
    validCodes: (raw as any).validCodes,
  };
};

createRoot(document.getElementById("root")!).render(<App loadData={loadData} />);
