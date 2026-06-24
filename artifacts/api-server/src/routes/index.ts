import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import sitesRouter from "./sites";
import pagesRouter from "./pages";
import postsRouter from "./posts";
import mediaRouter from "./media";
import usersRouter from "./users";
import taxonomyRouter from "./taxonomy";
import menusRouter from "./menus";
import formsRouter from "./forms";
import seoRouter from "./seo";
import aiRouter from "./ai";
import calendarRouter from "./calendar";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/dashboard", dashboardRouter);
router.use("/sites", sitesRouter);
router.use("/pages", pagesRouter);
router.use("/posts", postsRouter);
router.use("/media", mediaRouter);
router.use("/users", usersRouter);
router.use(taxonomyRouter);
router.use("/menus", menusRouter);
router.use("/forms", formsRouter);
router.use("/seo", seoRouter);
router.use("/ai", aiRouter);
router.use("/calendar", calendarRouter);

export default router;
