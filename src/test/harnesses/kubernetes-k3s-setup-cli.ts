import { ConsoleK3sSetupProgress } from "./kubernetes-k3s-progress.js";
import { setupK3sInfrastructure } from "./kubernetes-k3s-setup.js";

const progress = new ConsoleK3sSetupProgress();

try {
	await setupK3sInfrastructure({ progress });
} finally {
	progress.finish();
}
