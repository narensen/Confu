// Goal templates: ready-made starting points with free, checked sources
// (every link imports cleanly: videos have transcripts, papers have open PDFs).
// Starting one creates a session with these sources and the goal filled in;
// the plan is then made for the student's own level, deadline and hours.

import type { PackContent, PackSource } from "@/lib/packs";
import type { Level } from "@confu/core/types";

export type Template = {
  slug: string;
  title: string;
  tagline: string;
  description: string; // for the template's page and search results
  kind: "study" | "paper" | "exam";
  level: Level;
  weeks: number;
  minutesPerDay: number;
  goal: string; // filled into the goal box
  outline: { phase: string; topics: string[] }[];
  sources: PackSource[];
  tags: string[];
};

const yt = (id: string, title: string): PackSource => ({ kind: "youtube", title, url: `https://www.youtube.com/watch?v=${id}` });
const web = (url: string, title: string): PackSource => ({ kind: "web", title, url });
const arxiv = (id: string, title: string, authors: string[], year: number): PackSource => ({
  kind: "paper",
  title,
  url: `https://arxiv.org/abs/${id}`,
  pdf_url: `https://arxiv.org/pdf/${id}`,
  arxiv_id: id,
  authors,
  year,
  doi: null,
  venue: "arXiv",
  abstract: null,
});

export const TEMPLATES: Template[] = [
  {
    slug: "neural-networks-from-scratch",
    title: "Neural networks from scratch",
    tagline: "From a single neuron to backpropagation you could code yourself.",
    description:
      "Learn how neural networks really work: neurons, layers, gradient descent and backpropagation, with 3Blue1Brown's visual series, Michael Nielsen's free book and Andrej Karpathy building a tiny autograd engine line by line.",
    kind: "study",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 45,
    goal: "Understand how a neural network learns, well enough to explain gradient descent and backpropagation on a whiteboard and to build a tiny neural network from scratch in Python.",
    outline: [
      { phase: "What a network is", topics: ["Neurons, weights and biases", "Layers and activations", "Recognising handwritten digits"] },
      { phase: "How it learns", topics: ["Cost functions", "Gradient descent", "Backpropagation, intuitively", "Backpropagation, the calculus"] },
      { phase: "Build one", topics: ["Derivatives as code", "A tiny autograd engine", "Training a small network"] },
    ],
    sources: [
      yt("aircAruvnKk", "But what is a neural network? (3Blue1Brown)"),
      yt("IHZwWFHWa-w", "Gradient descent, how neural networks learn (3Blue1Brown)"),
      yt("Ilg3gGewQ5U", "Backpropagation, intuitively (3Blue1Brown)"),
      yt("tIeHLnjs5U8", "Backpropagation calculus (3Blue1Brown)"),
      web("http://neuralnetworksanddeeplearning.com/chap1.html", "Using neural nets to recognize handwritten digits (Michael Nielsen)"),
      yt("VMj-3S1tku0", "Building micrograd: neural networks and backpropagation, spelled out (Andrej Karpathy)"),
    ],
    tags: ["Machine learning", "Deep learning", "Beginner"],
  },
  {
    slug: "transformers-and-llms",
    title: "Transformers and large language models",
    tagline: "How ChatGPT-style models work, down to attention and a GPT you build yourself.",
    description:
      "Understand the transformer, the architecture behind every modern language model: attention, embeddings and training, from 3Blue1Brown's visual chapters and The Illustrated Transformer to the original paper, then build a small GPT with Andrej Karpathy.",
    kind: "study",
    level: "intermediate",
    weeks: 3,
    minutesPerDay: 60,
    goal: "Understand how transformers and large language models work: explain self-attention, embeddings and next-token prediction, read the 'Attention Is All You Need' paper comfortably, and build a small GPT myself.",
    outline: [
      { phase: "The big picture", topics: ["What a language model predicts", "Tokens and embeddings", "How LLMs are trained and fine-tuned"] },
      { phase: "Attention", topics: ["Queries, keys and values", "Multi-head attention", "Positional information", "Where facts are stored"] },
      { phase: "The paper and the code", topics: ["Reading 'Attention Is All You Need'", "Encoder and decoder", "Building a GPT from scratch"] },
    ],
    sources: [
      yt("zjkBMFhNj_g", "Intro to Large Language Models (Andrej Karpathy)"),
      yt("wjZofJX0v4M", "Transformers, the tech behind LLMs (3Blue1Brown)"),
      yt("eMlx5fFNoYc", "Attention in transformers, step-by-step (3Blue1Brown)"),
      yt("9-Jl0dxWQs8", "How might LLMs store facts (3Blue1Brown)"),
      web("https://jalammar.github.io/illustrated-transformer/", "The Illustrated Transformer (Jay Alammar)"),
      arxiv("1706.03762", "Attention Is All You Need", ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"], 2017),
      yt("kCc8FmEb1nY", "Let's build GPT: from scratch, in code, spelled out (Andrej Karpathy)"),
    ],
    tags: ["Machine learning", "LLMs", "Deep learning"],
  },
  {
    slug: "reinforcement-learning-to-ppo",
    title: "Reinforcement learning, from basics to PPO",
    tagline: "Agents, rewards and policies, up to the algorithm behind RLHF.",
    description:
      "Learn reinforcement learning properly: Markov decision processes, value functions, Q-learning and policy gradients, with David Silver's first lecture, OpenAI's Spinning Up and Lilian Weng's guide, then read the DQN and PPO papers.",
    kind: "study",
    level: "intermediate",
    weeks: 4,
    minutesPerDay: 60,
    goal: "Understand reinforcement learning from the ground up: explain MDPs, value functions, Q-learning and policy gradients, and read and explain the DQN and PPO papers.",
    outline: [
      { phase: "Foundations", topics: ["Agents, environments and rewards", "Markov decision processes", "Value functions and Bellman equations"] },
      { phase: "Value-based methods", topics: ["Q-learning", "Deep Q-networks", "Experience replay and target networks"] },
      { phase: "Policy methods", topics: ["Policy gradients and REINFORCE", "Actor-critic methods", "Trust regions and PPO"] },
    ],
    sources: [
      yt("2pWv7GOvuf0", "RL Course by David Silver, Lecture 1: Introduction to Reinforcement Learning"),
      web("https://spinningup.openai.com/en/latest/spinningup/rl_intro.html", "Key Concepts in RL (OpenAI Spinning Up)"),
      web("https://lilianweng.github.io/posts/2018-04-08-policy-gradient/", "Policy Gradient Algorithms (Lilian Weng)"),
      arxiv("1312.5602", "Playing Atari with Deep Reinforcement Learning", ["Volodymyr Mnih", "Koray Kavukcuoglu", "David Silver", "Alex Graves", "Ioannis Antonoglou", "Daan Wierstra", "Martin Riedmiller"], 2013),
      arxiv("1707.06347", "Proximal Policy Optimization Algorithms", ["John Schulman", "Filip Wolski", "Prafulla Dhariwal", "Alec Radford", "Oleg Klimov"], 2017),
    ],
    tags: ["Machine learning", "Reinforcement learning"],
  },
  {
    slug: "linear-algebra-visually",
    title: "Linear algebra, the visual way",
    tagline: "Vectors, matrices and eigenvectors you can actually picture.",
    description:
      "Build a real intuition for linear algebra: vectors, span, linear transformations, matrix multiplication, determinants, inverses and eigenvectors, with 3Blue1Brown's Essence of Linear Algebra and Gilbert Strang's first MIT 18.06 lecture.",
    kind: "study",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Understand linear algebra geometrically: picture what vectors, matrices, determinants, inverses and eigenvectors mean, and solve standard problems with that understanding.",
    outline: [
      { phase: "Vectors and transformations", topics: ["Vectors", "Linear combinations, span and basis", "Linear transformations as matrices", "Matrix multiplication as composition"] },
      { phase: "What matrices tell you", topics: ["The determinant", "Inverses, column space and null space", "Systems of equations"] },
      { phase: "Eigen-everything", topics: ["Eigenvectors and eigenvalues", "Why they matter"] },
    ],
    sources: [
      yt("fNk_zzaMoSs", "Vectors (Essence of Linear Algebra, 3Blue1Brown)"),
      yt("k7RM-ot2NWY", "Linear combinations, span, and basis vectors (3Blue1Brown)"),
      yt("kYB8IZa5AuE", "Linear transformations and matrices (3Blue1Brown)"),
      yt("XkY2DOUCWMU", "Matrix multiplication as composition (3Blue1Brown)"),
      yt("Ip3X9LOh2dk", "The determinant (3Blue1Brown)"),
      yt("uQhTuRlWMxw", "Inverse matrices, column space and null space (3Blue1Brown)"),
      yt("PFDu9oVAE-g", "Eigenvectors and eigenvalues (3Blue1Brown)"),
      yt("ZK3O402wf1c", "MIT 18.06 Linear Algebra, Lecture 1 (Gilbert Strang)"),
    ],
    tags: ["Maths", "Beginner"],
  },
  {
    slug: "calculus-essentials",
    title: "The essence of calculus",
    tagline: "Derivatives and integrals as ideas, not just rules.",
    description:
      "Understand calculus from first principles: what a derivative really is, the chain and product rules, why e is special, and how integration and the fundamental theorem fit together, with 3Blue1Brown's Essence of Calculus.",
    kind: "study",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Understand the core ideas of calculus: explain what derivatives and integrals mean, derive the main rules geometrically, and solve standard problems without memorising formulas blindly.",
    outline: [
      { phase: "Derivatives", topics: ["The essence of calculus", "The paradox of the derivative", "Derivative formulas through geometry", "The chain and product rules"] },
      { phase: "Special functions", topics: ["Why e is special", "Exponentials and growth"] },
      { phase: "Integrals", topics: ["Integration as area", "The fundamental theorem of calculus"] },
    ],
    sources: [
      yt("WUvTyaaNkzM", "The essence of calculus (3Blue1Brown)"),
      yt("9vKqVkMQHKk", "The paradox of the derivative (3Blue1Brown)"),
      yt("S0_qX4VJhMQ", "Derivative formulas through geometry (3Blue1Brown)"),
      yt("YG15m2VwSjA", "Visualizing the chain rule and product rule (3Blue1Brown)"),
      yt("m2MIpDrF7Es", "What's so special about Euler's number e? (3Blue1Brown)"),
      yt("rfG8ce4nNh0", "Integration and the fundamental theorem of calculus (3Blue1Brown)"),
    ],
    tags: ["Maths", "Beginner"],
  },
  {
    slug: "machine-learning-foundations",
    title: "Machine learning foundations",
    tagline: "Regression, classification and how models generalise.",
    description:
      "The foundations of machine learning: supervised learning, linear and logistic regression, gradient descent and the bias-variance tradeoff, starting from Andrew Ng's first Stanford CS229 lecture.",
    kind: "study",
    level: "intermediate",
    weeks: 4,
    minutesPerDay: 60,
    goal: "Understand the foundations of machine learning: explain supervised learning, linear and logistic regression, gradient descent and the bias-variance tradeoff, and know how to tell whether a model generalises.",
    outline: [
      { phase: "Supervised learning", topics: ["What learning from data means", "Linear regression", "Gradient descent"] },
      { phase: "Classification", topics: ["Logistic regression", "Decision boundaries", "Probabilistic interpretation"] },
      { phase: "Generalisation", topics: ["Overfitting and underfitting", "The bias-variance tradeoff", "Regularisation"] },
    ],
    sources: [
      yt("jGwO_UgTS7I", "Stanford CS229: Machine Learning, Lecture 1 (Andrew Ng)"),
      web("https://en.wikipedia.org/wiki/Linear_regression", "Linear regression (Wikipedia)"),
      web("https://en.wikipedia.org/wiki/Gradient_descent", "Gradient descent (Wikipedia)"),
      web("https://en.wikipedia.org/wiki/Logistic_regression", "Logistic regression (Wikipedia)"),
      web("https://en.wikipedia.org/wiki/Bias%E2%80%93variance_tradeoff", "Bias-variance tradeoff (Wikipedia)"),
    ],
    tags: ["Machine learning"],
  },
  {
    slug: "learn-python",
    title: "Learn Python",
    tagline: "From zero to writing your own small programs.",
    description:
      "Learn Python from scratch: variables, control flow, functions and data structures, with freeCodeCamp's full beginner course and the official Python tutorial.",
    kind: "study",
    level: "beginner",
    weeks: 3,
    minutesPerDay: 45,
    goal: "Learn Python well enough to write my own small programs: variables, control flow, functions, lists and dictionaries, and reading other people's code.",
    outline: [
      { phase: "Basics", topics: ["Running Python", "Numbers, strings and variables", "Lists"] },
      { phase: "Control flow", topics: ["If statements and loops", "Functions", "Errors and debugging"] },
      { phase: "Data", topics: ["Dictionaries, sets and tuples", "Working with data structures", "A small project"] },
    ],
    sources: [
      yt("rfscVS0vtbw", "Learn Python, Full Course for Beginners (freeCodeCamp)"),
      web("https://docs.python.org/3/tutorial/introduction.html", "An Informal Introduction to Python (Python tutorial)"),
      web("https://docs.python.org/3/tutorial/controlflow.html", "More Control Flow Tools (Python tutorial)"),
      web("https://docs.python.org/3/tutorial/datastructures.html", "Data Structures (Python tutorial)"),
    ],
    tags: ["Programming", "Beginner"],
  },
  {
    slug: "algorithms-and-data-structures",
    title: "Algorithms and data structures",
    tagline: "The interview and exam staples, understood rather than memorised.",
    description:
      "Learn the core algorithms and data structures: Big O, arrays, linked lists, hash tables, sorting, searching and dynamic programming, with freeCodeCamp's full course and clear reference articles.",
    kind: "study",
    level: "intermediate",
    weeks: 4,
    minutesPerDay: 60,
    goal: "Understand the core algorithms and data structures well enough to analyse running time with Big O, choose the right structure for a problem, and solve standard dynamic programming problems.",
    outline: [
      { phase: "Analysis", topics: ["Big O notation", "Time and space complexity"] },
      { phase: "Data structures", topics: ["Arrays and linked lists", "Hash tables", "Trees"] },
      { phase: "Algorithms", topics: ["Searching", "Sorting", "Recursion", "Dynamic programming"] },
    ],
    sources: [
      yt("8hly31xKli0", "Algorithms and Data Structures, Full Course for Beginners (freeCodeCamp)"),
      web("https://en.wikipedia.org/wiki/Big_O_notation", "Big O notation (Wikipedia)"),
      web("https://en.wikipedia.org/wiki/Hash_table", "Hash table (Wikipedia)"),
      web("https://en.wikipedia.org/wiki/Dynamic_programming", "Dynamic programming (Wikipedia)"),
    ],
    tags: ["Programming", "Computer science"],
  },
  {
    slug: "landmark-ai-papers",
    title: "Ten landmark AI papers",
    tagline: "The papers modern AI is built on, read the researcher's way.",
    description:
      "Read the papers modern AI is built on, from Adam and ResNet to Attention Is All You Need, BERT, GPT-3 and the scaling laws, with the three-pass method: know which deserve a deep read and what each one changed.",
    kind: "paper",
    level: "intermediate",
    weeks: 5,
    minutesPerDay: 45,
    goal: "Understand the landmark papers of modern AI: what problem each solved, its key idea and evidence, and how it shaped what came after.",
    outline: [
      { phase: "Training and architectures", topics: ["Adam", "Generative adversarial networks", "Residual networks"] },
      { phase: "Reinforcement learning", topics: ["Deep Q-networks", "PPO"] },
      { phase: "Transformers", topics: ["Attention Is All You Need", "BERT", "Vision Transformers"] },
      { phase: "Scale", topics: ["Scaling laws", "GPT-3 and few-shot learning"] },
    ],
    sources: [
      arxiv("1412.6980", "Adam: A Method for Stochastic Optimization", ["Diederik P. Kingma", "Jimmy Ba"], 2014),
      arxiv("1406.2661", "Generative Adversarial Networks", ["Ian J. Goodfellow", "Jean Pouget-Abadie", "Mehdi Mirza", "Bing Xu", "David Warde-Farley", "Sherjil Ozair", "Aaron Courville", "Yoshua Bengio"], 2014),
      arxiv("1512.03385", "Deep Residual Learning for Image Recognition", ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"], 2015),
      arxiv("1312.5602", "Playing Atari with Deep Reinforcement Learning", ["Volodymyr Mnih", "Koray Kavukcuoglu", "David Silver", "Alex Graves", "Ioannis Antonoglou", "Daan Wierstra", "Martin Riedmiller"], 2013),
      arxiv("1707.06347", "Proximal Policy Optimization Algorithms", ["John Schulman", "Filip Wolski", "Prafulla Dhariwal", "Alec Radford", "Oleg Klimov"], 2017),
      arxiv("1706.03762", "Attention Is All You Need", ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"], 2017),
      arxiv("1810.04805", "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding", ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"], 2018),
      arxiv("2010.11929", "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale", ["Alexey Dosovitskiy", "Lucas Beyer", "Alexander Kolesnikov", "Dirk Weissenborn"], 2020),
      arxiv("2001.08361", "Scaling Laws for Neural Language Models", ["Jared Kaplan", "Sam McCandlish", "Tom Henighan", "Tom B. Brown", "Benjamin Chess", "Rewon Child", "Scott Gray", "Alec Radford", "Jeffrey Wu", "Dario Amodei"], 2020),
      arxiv("2005.14165", "Language Models are Few-Shot Learners", ["Tom B. Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah", "Jared Kaplan", "Prafulla Dhariwal"], 2020),
    ],
    tags: ["Research", "Machine learning", "Papers"],
  },
  {
    slug: "quantum-computing-basics",
    title: "Quantum computing for the curious",
    tagline: "Qubits, gates and circuits, without a physics degree.",
    description:
      "Understand what quantum computers actually do: qubits, superposition, quantum gates and circuits, measurement and what makes quantum algorithms faster, with Andy Matuschak and Michael Nielsen's Quantum Computing for the Very Curious.",
    kind: "study",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Understand the basics of quantum computing: explain qubits, superposition, quantum gates, circuits and measurement, and what quantum computers can and can't do faster.",
    outline: [
      { phase: "Qubits", topics: ["States and superposition", "Measurement", "The Bloch sphere"] },
      { phase: "Computing", topics: ["Quantum gates", "Circuits", "Entanglement"] },
      { phase: "What it's for", topics: ["Why some problems get faster", "Limits of quantum computers"] },
    ],
    sources: [
      web("https://quantum.country/qcvc", "Quantum computing for the very curious (Andy Matuschak and Michael Nielsen)"),
      web("https://en.wikipedia.org/wiki/Qubit", "Qubit (Wikipedia)"),
    ],
    tags: ["Physics", "Computer science", "Beginner"],
  },
  {
    slug: "science-of-learning",
    title: "The science of learning",
    tagline: "How memory works, and how to study so things stick.",
    description:
      "Learn how memory really works and the study techniques research supports: retrieval practice, spacing and interleaving, with Confu's short guide and the research behind the testing and spacing effects.",
    kind: "study",
    level: "beginner",
    weeks: 1,
    minutesPerDay: 30,
    goal: "Understand what memory research says about learning, and build a weekly study routine around retrieval practice and spacing.",
    outline: [
      { phase: "How memory works", topics: ["The forgetting curve", "Why rereading feels like learning"] },
      { phase: "What works", topics: ["Retrieval practice", "Spacing", "Interleaving and elaboration"] },
      { phase: "Your routine", topics: ["A weekly plan", "Measuring what you know"] },
    ],
    sources: [
      { kind: "sample", title: "How to Learn Anything: A Short Guide to the Science of Learning", url: null },
      web("https://en.wikipedia.org/wiki/Testing_effect", "Testing effect (Wikipedia)"),
      web("https://en.wikipedia.org/wiki/Spacing_effect", "Spacing effect (Wikipedia)"),
    ],
    tags: ["Study skills", "Beginner"],
  },
  {
    slug: "electric-charges-and-fields",
    title: "Electric charges and fields",
    tagline: "Charge, Coulomb's law, fields and dipoles, from an open textbook.",
    description:
      "A first-year exam on electric charge and fields, from OpenStax University Physics Volume 2 (Samuel J. Ling, Jeff Sanny and William Moebs, CC BY 4.0). Copy it and Confu fetches the chapter into an exam session, so you can sit a timed paper from the text.",
    kind: "exam",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Be ready for an exam on electric charges and fields: explain charge, conductors and insulators, Coulomb's law, the electric field, field lines and electric dipoles, and work a short problem on each.",
    outline: [
      { phase: "Charge", topics: ["What charge is", "Conductors and insulators", "Charging by induction"] },
      { phase: "Forces and fields", topics: ["Coulomb's law", "The electric field", "Field of a point charge"] },
      { phase: "Pictures", topics: ["Field lines", "Electric dipoles"] },
    ],
    sources: [
      web("https://openstax.org/books/university-physics-volume-2/pages/5-introduction", "Electric charges and fields (OpenStax University Physics Volume 2)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/5-1-electric-charge", "Electric charge (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/5-3-coulombs-law", "Coulomb's law (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/5-4-electric-field", "Electric field (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/5-7-electric-dipoles", "Electric dipoles (OpenStax)"),
    ],
    tags: ["Physics", "Exam"],
  },
  {
    slug: "gauss-law",
    title: "Gauss's law",
    tagline: "Flux, symmetry, and the field of a sphere and a line.",
    description:
      "A first-year exam on Gauss's law, from OpenStax University Physics Volume 2 (Samuel J. Ling, Jeff Sanny and William Moebs, CC BY 4.0). Copy it and Confu fetches the chapter into an exam session.",
    kind: "exam",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Be ready for an exam on Gauss's law: explain flux, use symmetry to find the field of a sphere, a line and a plane, and say what the field is inside a conductor in equilibrium.",
    outline: [
      { phase: "Flux", topics: ["What flux counts", "Open and closed surfaces"] },
      { phase: "The law", topics: ["Gauss's law", "When symmetry is enough"] },
      { phase: "Uses", topics: ["Sphere", "Line and plane", "Conductors in equilibrium"] },
    ],
    sources: [
      web("https://openstax.org/books/university-physics-volume-2/pages/6-introduction", "Gauss's law (OpenStax University Physics Volume 2)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/6-1-electric-flux", "Electric flux (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/6-2-explaining-gausss-law", "Explaining Gauss's law (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/6-3-applying-gausss-law", "Applying Gauss's law (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/6-4-conductors-in-electrostatic-equilibrium", "Conductors in electrostatic equilibrium (OpenStax)"),
    ],
    tags: ["Physics", "Exam"],
  },
  {
    slug: "electric-potential",
    title: "Electric potential",
    tagline: "Potential energy, potential, and the potential of a point charge.",
    description:
      "A first-year exam on electric potential, from OpenStax University Physics Volume 2 (Samuel J. Ling, Jeff Sanny and William Moebs, CC BY 4.0). Copy it and Confu fetches the chapter into an exam session.",
    kind: "exam",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Be ready for an exam on electric potential: relate potential energy to work, distinguish potential from potential difference, and compute the potential of a point charge and a simple group of charges.",
    outline: [
      { phase: "Energy", topics: ["Potential energy", "Work by the field"] },
      { phase: "Potential", topics: ["Potential and potential difference", "From the field to potential"] },
      { phase: "Charges", topics: ["Potential of a point charge", "Several point charges"] },
    ],
    sources: [
      web("https://openstax.org/books/university-physics-volume-2/pages/7-introduction", "Electric potential (OpenStax University Physics Volume 2)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/7-1-electric-potential-energy", "Electric potential energy (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/7-2-electric-potential-and-potential-difference", "Electric potential and potential difference (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/7-3-calculations-of-electric-potential", "Calculations of electric potential (OpenStax)"),
    ],
    tags: ["Physics", "Exam"],
  },
  {
    slug: "capacitance",
    title: "Capacitance",
    tagline: "Capacitors, series and parallel, energy, and a dielectric.",
    description:
      "A first-year exam on capacitance, from OpenStax University Physics Volume 2 (Samuel J. Ling, Jeff Sanny and William Moebs, CC BY 4.0). Copy it and Confu fetches the chapter into an exam session.",
    kind: "exam",
    level: "beginner",
    weeks: 2,
    minutesPerDay: 40,
    goal: "Be ready for an exam on capacitance: find the capacitance of a simple capacitor, combine capacitors in series and parallel, compute the energy stored, and say what a dielectric does at the level of the chapter.",
    outline: [
      { phase: "One capacitor", topics: ["What capacitance is", "A parallel-plate capacitor"] },
      { phase: "Combinations", topics: ["Series", "Parallel"] },
      { phase: "Energy", topics: ["Energy stored", "A dielectric"] },
    ],
    sources: [
      web("https://openstax.org/books/university-physics-volume-2/pages/8-introduction", "Capacitance (OpenStax University Physics Volume 2)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/8-1-capacitors-and-capacitance", "Capacitors and capacitance (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/8-2-capacitors-in-series-and-in-parallel", "Capacitors in series and in parallel (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/8-3-energy-stored-in-a-capacitor", "Energy stored in a capacitor (OpenStax)"),
      web("https://openstax.org/books/university-physics-volume-2/pages/8-4-capacitor-with-a-dielectric", "Capacitor with a dielectric (OpenStax)"),
    ],
    tags: ["Physics", "Exam"],
  },
];

export const templateBySlug = (slug: string) => TEMPLATES.find((t) => t.slug === slug) ?? null;

export const templateContent = (t: Template): PackContent => ({ v: 1, sources: t.sources, plan: null, topics: [], highlights: [], passes: [], goal: t.goal });
