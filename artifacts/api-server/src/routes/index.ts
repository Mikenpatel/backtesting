import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import tradesRouter from "./trades";
import strategiesRouter from "./strategies";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(tradesRouter);
router.use(strategiesRouter);
router.use(dashboardRouter);

export default router;
