import { Request, Response, NextFunction } from "express";

export function pinAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const clientPin = req.headers["x-dashboard-pin"];
  const serverPin = process.env.DASHBOARD_PIN;

  if (!serverPin) {
    return res.status(500).json({ error: "Server PIN not configured" });
  }

  if (clientPin !== serverPin) {
    return res.status(401).json({ error: "Invalid PIN" });
  }

  req.auth = { userId: "pin-dashboard" };
  next();
}
