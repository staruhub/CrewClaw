import { Routes, Route, useLocation } from "react-router";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import EmployeeDetail from "./pages/EmployeeDetail";
import CreatorConsole from "./pages/CreatorConsole";
import CrewMode from "./pages/CrewMode";
import HireConfirm from "./pages/HireConfirm";
import Home from "./pages/Home";
import Marketplace from "./pages/Marketplace";
import Metrics from "./pages/Metrics";
import Performance from "./pages/Performance";
import ReviewQueue from "./pages/ReviewQueue";
import Search from "./pages/Search";
import TaskRun from "./pages/TaskRun";
import TeamDashboard from "./pages/TeamDashboard";

export default function App() {
  const { pathname } = useLocation();

  return (
    <>
      {pathname !== "/" ? (
        <LanguageSwitcher className="fixed right-4 top-4 z-[1200]" />
      ) : null}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/search" element={<Search />} />
        <Route path="/employee/:id" element={<EmployeeDetail />} />
        <Route path="/hire/:id" element={<HireConfirm />} />
        <Route path="/team" element={<TeamDashboard />} />
        <Route path="/task-run/:id" element={<TaskRun />} />
        <Route path="/crew" element={<CrewMode />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/creator" element={<CreatorConsole />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/metrics" element={<Metrics />} />
      </Routes>
    </>
  );
}
