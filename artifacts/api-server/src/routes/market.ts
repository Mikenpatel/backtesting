import { Router, type IRouter } from "express";
import { GetMarketQuoteQueryParams, GetOptionChainQueryParams, GetExpiriesQueryParams } from "@workspace/api-zod";
import { getQuote, getOptionChain, getExpiries } from "../lib/market-adapter";

const router: IRouter = Router();

router.get("/market/quote", async (req, res): Promise<void> => {
  const parsed = GetMarketQuoteQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const quote = await getQuote(parsed.data.symbol);
  res.json(quote);
});

router.get("/market/option-chain", async (req, res): Promise<void> => {
  const parsed = GetOptionChainQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const chain = await getOptionChain(parsed.data.symbol, parsed.data.expiry);
  res.json(chain);
});

router.get("/market/expiries", async (req, res): Promise<void> => {
  const parsed = GetExpiriesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const expiries = await getExpiries(parsed.data.symbol);
  res.json({ symbol: parsed.data.symbol, expiries });
});

export default router;
