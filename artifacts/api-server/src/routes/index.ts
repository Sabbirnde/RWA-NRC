import { Router, type IRouter } from "express";
import healthRouter from "./health";
import protocolRouter from "./protocol";
import firecrawlRouter from "./firecrawl";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(protocolRouter);
router.use(firecrawlRouter);
router.use(webhooksRouter);

export default router;
