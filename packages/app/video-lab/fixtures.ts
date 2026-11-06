// Study material for the video test runs: short textbook-style passages
// picked so that, between them, every template has a natural use (a function
// to plot, real numbers to chart, dates, a cycle, code, a process…).

export type Fixture = { slug: string; title: string; pages: { page: number; text: string }[] };

const p = (...texts: string[]) => texts.map((text, i) => ({ page: i + 1, text }));

export const FIXTURES: Fixture[] = [
  {
    slug: "pca",
    title: "Principal Component Analysis",
    pages: p(
      "High-dimensional data is hard to visualise and expensive to model, yet much of it lies close to a lower-dimensional subspace. Principal component analysis (PCA) finds that subspace by asking which directions the data varies most along. First the data is centred, so that its mean is zero. For a unit vector u, the projection of a point x onto u is the scalar uᵀx, and the variance of the projected data is uᵀSu, where S is the covariance matrix.",
      "The first principal component is the direction along which the projected data has maximal variance; it is the eigenvector of S with the largest eigenvalue. Each further component is the direction of greatest remaining variance, orthogonal to the previous ones. In the wine dataset, the first component explains 36% of the variance, the second 19%, the third 11% and the fourth 7%. Keeping the first two components keeps 55% of the variance while reducing 13 features to 2.",
      "Steps: centre the data; compute the covariance matrix; compute its eigenvectors and eigenvalues; sort them by eigenvalue; project the data onto the top M eigenvectors. In NumPy: X = X - X.mean(axis=0); S = np.cov(X.T); vals, vecs = np.linalg.eigh(S); top = vecs[:, ::-1][:, :2]; Z = X @ top.",
    ),
  },
  {
    slug: "photosynthesis",
    title: "Photosynthesis",
    pages: p(
      "Photosynthesis is the process by which plants, algae and some bacteria convert light energy into chemical energy stored in glucose. It takes place in chloroplasts, mainly in the leaves. The overall equation is 6CO2 + 6H2O + light energy → C6H12O6 + 6O2. Chlorophyll, the green pigment in the thylakoid membranes, absorbs mostly red and blue light and reflects green.",
      "Photosynthesis has two stages. In the light-dependent reactions, in the thylakoid membranes, light splits water, releasing oxygen, and produces ATP and NADPH. In the light-independent reactions (the Calvin cycle), in the stroma, the ATP and NADPH are used to fix carbon dioxide into sugar. The Calvin cycle has three phases: carbon fixation by the enzyme RuBisCO, reduction to G3P, and regeneration of RuBP so the cycle can continue.",
      "The rate of photosynthesis depends on light intensity, carbon dioxide concentration and temperature. Each can become the limiting factor. Most plants photosynthesise fastest between 25 and 35 degrees Celsius; above about 40 degrees, enzymes begin to denature and the rate falls sharply.",
    ),
  },
  {
    slug: "supply-demand",
    title: "Supply and demand",
    pages: p(
      "In a competitive market, the price of a good is set by supply and demand. The law of demand says that, other things equal, as the price rises the quantity demanded falls. The law of supply says that as the price rises the quantity supplied rises. The market reaches equilibrium where the two curves cross: the quantity buyers want equals the quantity sellers offer.",
      "Example: a town's coffee market. At $2 a cup, buyers want 900 cups a day and cafés offer 300. At $3, demand is 700 and supply 500. At $4, demand and supply are both 600: this is the equilibrium. At $5, demand falls to 400 while supply rises to 800, leaving a surplus. A shortage pushes prices up and a surplus pushes them down, until the market clears.",
      "Demand shifts when something other than price changes: income, tastes, the price of related goods (substitutes and complements), or expectations. A shift is different from a movement along the curve, which is caused only by a change in the good's own price. Price elasticity of demand measures how strongly quantity responds to price: elastic goods (luxuries, goods with many substitutes) respond strongly; inelastic goods (necessities like insulin) barely respond.",
    ),
  },
  {
    slug: "french-revolution",
    title: "The French Revolution",
    pages: p(
      "The French Revolution (1789–1799) transformed France from an absolute monarchy into a republic. Its causes included a fiscal crisis after costly wars, including support for the American Revolution, poor harvests that raised bread prices, and Enlightenment ideas about rights and the sovereignty of the people. Society was divided into three estates: the clergy, the nobility, and everyone else, the Third Estate, which paid most of the taxes.",
      "In May 1789 Louis XVI called the Estates-General for the first time since 1614. In June the Third Estate declared itself the National Assembly and swore the Tennis Court Oath. On 14 July 1789 crowds stormed the Bastille. In August the Assembly adopted the Declaration of the Rights of Man and of the Citizen. In 1792 France became a republic, and Louis XVI was executed in January 1793. The Reign of Terror (1793–1794) under Robespierre saw about 17,000 official executions. In 1799 Napoleon Bonaparte seized power in a coup.",
    ),
  },
  {
    slug: "binary-search",
    title: "Binary search",
    pages: p(
      "Binary search finds a target value in a sorted array by repeatedly halving the search interval. Compare the target with the middle element: if they are equal, you are done; if the target is smaller, continue in the left half; otherwise continue in the right half. Because the interval halves each time, binary search takes at most about log2(n) comparisons: for a million elements, about 20 comparisons, compared with up to a million for a linear scan.",
      "def binary_search(a, target):\n    lo, hi = 0, len(a) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if a[mid] == target:\n            return mid\n        if a[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n\nCommon bugs: using lo < hi instead of lo <= hi, which misses the last element; forgetting the +1 and -1, which loops forever; and, in languages with fixed-size integers, computing (lo + hi) / 2 can overflow, so use lo + (hi - lo) / 2.",
    ),
  },
  {
    slug: "mitosis",
    title: "The cell cycle and mitosis",
    pages: p(
      "The cell cycle is the sequence of events by which a cell grows and divides into two daughter cells. It has two main parts: interphase, when the cell grows and copies its DNA, and the mitotic phase, when it divides. Interphase has three stages: G1 (growth), S (DNA synthesis) and G2 (preparation for division). In a typical human cell that divides every 24 hours, interphase takes about 23 hours and mitosis about 1 hour.",
      "Mitosis has four phases. In prophase, chromosomes condense and the spindle forms. In metaphase, chromosomes line up at the cell's equator. In anaphase, sister chromatids are pulled to opposite poles. In telophase, nuclear envelopes re-form around the two sets of chromosomes. Cytokinesis then splits the cytoplasm, giving two genetically identical cells. Checkpoints at G1, G2 and metaphase stop the cycle if DNA is damaged; when these fail, cells can divide uncontrollably, which is how cancers grow.",
    ),
  },
  {
    slug: "compound-interest",
    title: "Compound interest",
    pages: p(
      "With compound interest, interest is earned on the interest already added, not just on the original amount. If a principal P is invested at an annual rate r, compounded once a year, after t years it grows to A = P(1 + r)^t. With simple interest it would grow only to P(1 + rt). The difference is small at first and enormous later.",
      "Example: $1,000 at 7% a year. After 10 years it is worth $1,967; after 20 years $3,870; after 30 years $7,612; after 40 years $14,974. The rule of 72 estimates the doubling time: divide 72 by the percentage rate. At 7%, money doubles in about 72 / 7 ≈ 10.3 years. Compounding more often helps a little: continuous compounding gives A = P e^(rt).",
    ),
  },
  {
    slug: "newton",
    title: "Newton's laws of motion",
    pages: p(
      "Newton's first law: an object stays at rest, or moves in a straight line at constant speed, unless a net force acts on it. This tendency to resist changes in motion is called inertia. Newton's second law: the net force on an object equals its mass times its acceleration, F = ma. Force is measured in newtons; one newton accelerates a 1 kg mass at 1 m/s². Newton's third law: when one object exerts a force on a second, the second exerts an equal and opposite force on the first.",
      "Example: a 1,200 kg car accelerates from 0 to 20 m/s in 8 seconds. Its acceleration is 2.5 m/s², so the net force on it is 3,000 N. Friction and air resistance oppose motion, so the engine must supply more than this. A falling object near Earth's surface accelerates at about 9.8 m/s² if air resistance is ignored, so its speed after t seconds is v = 9.8t and the distance fallen is d = 4.9t².",
    ),
  },
  {
    slug: "tcp",
    title: "How TCP connections work",
    pages: p(
      "TCP (Transmission Control Protocol) gives applications a reliable, ordered stream of bytes over an unreliable network. Before sending data, the two sides set up a connection with a three-way handshake: the client sends SYN with its starting sequence number; the server replies SYN-ACK, acknowledging it and sending its own; the client replies ACK. Now both sides know each other's sequence numbers and data can flow.",
      "Reliability comes from sequence numbers and acknowledgements: the receiver acknowledges the bytes it has received, and the sender retransmits anything not acknowledged within a timeout. Flow control (the receive window) stops a fast sender overwhelming a slow receiver. Congestion control (slow start, then congestion avoidance) stops senders overwhelming the network. UDP, by contrast, sends independent datagrams with no handshake, no ordering and no retransmission: it is faster and simpler, which suits live video and games, but the application must cope with loss.",
    ),
  },
  {
    slug: "water-cycle",
    title: "The water cycle",
    pages: p(
      "The water cycle describes how water moves continuously between the oceans, the atmosphere and the land. The sun heats water in oceans, lakes and rivers, and it evaporates into water vapour; plants also release water vapour from their leaves, called transpiration. As the vapour rises it cools and condenses into tiny droplets that form clouds. When droplets combine and grow heavy, they fall as precipitation: rain, snow, sleet or hail.",
      "On land, water collects in rivers, lakes and underground aquifers, or runs off into the sea, and the cycle starts again. About 97% of Earth's water is salt water in the oceans; about 2% is frozen in ice caps and glaciers; less than 1% is liquid fresh water available in lakes, rivers and groundwater. A water molecule spends on average about 9 days in the atmosphere but can stay thousands of years in the deep ocean.",
    ),
  },
  {
    slug: "backprop",
    title: "Backpropagation",
    pages: p(
      "A neural network learns by adjusting its weights to reduce a loss function, such as the squared error between its prediction and the target. Gradient descent changes each weight w by a small step against the gradient: w ← w − η ∂L/∂w, where η is the learning rate. Backpropagation is the algorithm that computes all these gradients efficiently, using the chain rule from calculus.",
      "Training repeats four steps: a forward pass computes the prediction layer by layer; the loss compares it with the target; a backward pass propagates the error from the output layer back to the input, computing each weight's gradient with the chain rule; finally every weight is updated. The sigmoid activation σ(x) = 1/(1 + e^(−x)) squashes values into (0, 1); its derivative σ(x)(1 − σ(x)) is at most 0.25, which is why deep networks of sigmoids suffer from vanishing gradients and why ReLU, max(0, x), is now more common.",
    ),
  },
  {
    slug: "entropy",
    title: "Entropy and the second law",
    pages: p(
      "Entropy measures how many microscopic arrangements of a system are consistent with what we observe of it. Boltzmann wrote it as S = k ln W, where W is the number of microstates and k is Boltzmann's constant. The second law of thermodynamics says that the total entropy of an isolated system never decreases: left alone, systems move towards their most probable, most disordered states.",
      "This is why heat flows from hot to cold, why an ice cube melts in a warm room, and why a broken glass doesn't reassemble. No heat engine can turn all its heat into work: a Carnot engine working between 500 K and 300 K can be at most 1 − 300/500 = 40% efficient. Living things don't break the law: they lower their own entropy by increasing the entropy of their surroundings, releasing heat as they use energy from food or sunlight.",
    ),
  },
];
