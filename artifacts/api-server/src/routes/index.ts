import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import sitesRouter from "./sites";
import pagesRouter from "./pages";
import postsRouter from "./posts";
import mediaRouter from "./media";
import usersRouter from "./users";
import taxonomyRouter from "./taxonomy";
import menusRouter from "./menus";
import formsRouter, { publicFormsRouter } from "./forms";
import seoRouter from "./seo";
import aiRouter from "./ai";
import calendarRouter from "./calendar";
import pipelineRouter from "./pipeline";
import pluginsRouter from "./plugins";
import subscribersRouter from "./subscribers";
import postImagesRouter from "./post-images";
import broadcastRouter from "./broadcast";
import postCommentsRouter from "./post-comments";
import diagnosticsRouter from "./diagnostics";
import diagnosticRouter from "./diagnostic";
import intakePublicRouter from "./intake-public";
import settingsRouter from "./settings";
import { apiGuard } from "../lib/auth-middleware";

const router: IRouter = Router();

router.use(healthRouter);

// Every route below is authenticated (Firebase ID token, legacy JWT cookie or API key)
// except the explicit public allow-list defined in lib/auth-middleware.ts.
router.use(apiGuard);
router.use("/public/forms", publicFormsRouter);
router.use("/auth", authRouter);
router.use("/dashboard", dashboardRouter);
router.use("/sites", sitesRouter);
router.use("/pages", pagesRouter);
router.use("/posts", postsRouter);
router.use("/posts/:id/images", postImagesRouter);
router.use("/posts/:id/broadcasts", broadcastRouter);
router.use("/posts/:id/comments", postCommentsRouter);
router.use("/media", mediaRouter);
router.use("/users", usersRouter);
router.use(taxonomyRouter);
router.use("/menus", menusRouter);
router.use("/forms", formsRouter);
router.use("/seo", seoRouter);
router.use("/ai", aiRouter);
router.use("/calendar", calendarRouter);
router.use("/pipeline", pipelineRouter);
router.use("/plugins", pluginsRouter);
router.use("/subscribers", subscribersRouter);
router.use("/diagnostics", diagnosticsRouter);
router.use("/diagnostic", diagnosticRouter);
router.use("/intake", intakePublicRouter);
router.use("/settings", settingsRouter);

export default router;
