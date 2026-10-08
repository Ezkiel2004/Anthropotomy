// Static panel content for the 3D Anatomy Explorer, keyed by body_systems.system_code.
// The database (teacher-edited) stays the source for description, structures, key facts and model;
// this file adds the summary, functions, trivia and source links the database has no fields for.
// To add a system: add an entry whose id matches its system_code. Every fact must be stated in a cited source.
import {firstSentence} from './format.js';

const openstax = (chapter, title) => ({
    title: `OpenStax Anatomy and Physiology 2e, Chapter ${chapter}: ${title}`,
    url: `https://openstax.org/books/anatomy-and-physiology-2e/pages/${chapter}-introduction`
});

export const systems = [
    {
        id: 'skeletal',
        summary: 'Supports and protects the body and works with muscles to produce movement.',
        description: 'The skeletal system is made of bones together with cartilage, ligaments and other connective tissues. The adult skeleton is divided into the axial skeleton (skull, vertebral column and thoracic cage) and the appendicular skeleton (the limbs and the girdles that attach them). Bone is living tissue that is continually broken down and rebuilt throughout life.',
        functions: ['Supports the body and gives it shape', 'Protects internal organs such as the brain, heart and lungs', 'Acts as levers that muscles pull on to produce movement', 'Stores minerals, especially calcium and phosphorus', 'Produces blood cells in red bone marrow'],
        trivia: ['The adult skeleton has 206 bones: 80 in the axial skeleton and 126 in the appendicular skeleton.', 'The hyoid bone in the neck is the only bone that does not articulate with any other bone.', 'Red bone marrow makes blood cells, while yellow bone marrow stores fat.', 'Bone is constantly remodeled: osteoclasts break old bone down and osteoblasts lay new bone down.'],
        sources: [openstax(6, 'Bone Tissue and the Skeletal System'), openstax(7, 'Axial Skeleton')]
    },
    {
        id: 'muscular',
        summary: 'Moves the body, maintains posture and produces heat.',
        description: 'The body has three types of muscle tissue: skeletal muscle, which moves the skeleton under voluntary control; cardiac muscle, which forms the wall of the heart; and smooth muscle, found in the walls of hollow organs and blood vessels. Skeletal muscles attach to bones through tendons and work in groups to produce movement. Muscle contraction also generates much of the body\'s heat.',
        functions: ['Produces movement of the skeleton', 'Maintains posture and body position', 'Stabilizes bones and joints', 'Generates heat that helps keep body temperature stable', 'Controls openings such as the anus and urethra with sphincter muscles'],
        trivia: ['Each skeletal muscle fiber is a single long cell that contains many nuclei.', 'Cardiac muscle cells are joined by intercalated discs, which help the heart contract as a unit.', 'Muscles can only pull, so they work in opposing pairs: when a prime mover contracts, its antagonist relaxes.', 'Many muscle names describe their size, shape, location or action. Gluteus maximus means "largest buttock muscle".'],
        sources: [openstax(10, 'Muscle Tissue'), openstax(11, 'The Muscular System')]
    },
    {
        id: 'circulatory',
        summary: 'Pumps blood through vessels to deliver oxygen and nutrients and to carry away wastes.',
        description: 'The circulatory (cardiovascular) system is made up of the heart, the blood vessels and the blood. The heart pumps blood through two circuits: the pulmonary circuit, which carries blood to the lungs to pick up oxygen, and the systemic circuit, which carries oxygen-rich blood to the rest of the body. Arteries carry blood away from the heart, veins return it, and capillaries are where exchange with the tissues takes place.',
        functions: ['Transports oxygen and nutrients to cells', 'Carries carbon dioxide and other wastes away for removal', 'Distributes hormones around the body', 'Helps regulate body temperature', 'Carries white blood cells that defend the body'],
        trivia: ['The heart has four chambers: two atria that receive blood and two ventricles that pump it out.', 'The sinoatrial (SA) node is the heart\'s natural pacemaker and starts each heartbeat.', 'Capillary walls are a single layer of endothelial cells, thin enough for gases and nutrients to pass through.', 'After birth, the pulmonary arteries are the only arteries that carry oxygen-poor blood, taking it to the lungs.', 'The human heart is roughly the size of a fist.'],
        sources: [openstax(19, 'The Cardiovascular System: The Heart'), openstax(20, 'The Cardiovascular System: Blood Vessels and Circulation')]
    },
    {
        id: 'respiratory',
        summary: 'Brings oxygen into the body and removes carbon dioxide.',
        description: 'The respiratory system includes the nose, pharynx, larynx, trachea, bronchi and lungs. Air travels through branching airways to tiny air sacs called alveoli, where oxygen moves into the blood and carbon dioxide moves out. Breathing is driven mainly by the diaphragm and the muscles between the ribs.',
        functions: ['Supplies oxygen to the blood and removes carbon dioxide (gas exchange)', 'Moves air into and out of the lungs (ventilation)', 'Filters, warms and humidifies incoming air', 'Produces sound for speech through the larynx', 'Helps regulate blood pH'],
        trivia: ['The right lung has three lobes and the left lung has two, leaving room for the heart.', 'The diaphragm is the main muscle of quiet breathing; it flattens as it contracts, drawing air in.', 'Surfactant made by type II alveolar cells lowers surface tension so the alveoli do not collapse.', 'The epiglottis covers the entrance to the larynx during swallowing so food does not enter the airway.'],
        sources: [openstax(22, 'The Respiratory System')]
    },
    {
        id: 'digestive',
        summary: 'Breaks food down into nutrients the body can absorb and removes the waste.',
        description: 'The digestive system consists of the alimentary canal (mouth, pharynx, esophagus, stomach, small intestine and large intestine) and accessory organs such as the teeth, tongue, salivary glands, liver, gallbladder and pancreas. Food is broken down mechanically and chemically, nutrients are absorbed mainly in the small intestine, and undigested material is eliminated as feces.',
        functions: ['Ingestion: taking food into the mouth', 'Propulsion: moving food along the tract by swallowing and peristalsis', 'Mechanical and chemical digestion of food', 'Absorption of nutrients into the blood and lymph', 'Defecation: eliminating undigested waste'],
        trivia: ['Most nutrient absorption happens in the small intestine, the longest part of the alimentary canal.', 'Villi and microvilli greatly increase the surface area of the small intestine for absorption.', 'The liver makes bile; the gallbladder stores it and releases it to help digest fats.', 'Salivary amylase in saliva starts the chemical digestion of starch in the mouth.', 'Bacteria in the large intestine produce some vitamins, including vitamin K.'],
        sources: [openstax(23, 'The Digestive System')]
    },
    {
        id: 'urinary',
        summary: 'Filters the blood and removes wastes as urine.',
        description: 'The urinary system is made up of two kidneys, two ureters, the urinary bladder and the urethra. The kidneys filter the blood to remove wastes and excess water, forming urine that flows down the ureters to the bladder, where it is stored until it leaves the body through the urethra. In doing so, the kidneys help control blood volume, blood pressure and the balance of salts and acids in the body.',
        functions: ['Filters wastes such as urea out of the blood', 'Regulates blood volume and blood pressure', 'Maintains the balance of water and electrolytes', 'Helps regulate blood pH', 'Stores and eliminates urine'],
        trivia: ['The kidneys lie behind the lining of the abdominal cavity (retroperitoneal), against the back wall of the abdomen.', 'The right kidney sits slightly lower than the left because the liver is above it.', 'The kidneys release erythropoietin, a hormone that signals the bone marrow to make red blood cells.', 'The bladder is lined with transitional epithelium, which lets it stretch as it fills.'],
        sources: [openstax(25, 'The Urinary System')]
    },
    {
        id: 'nervous',
        summary: 'Coordinates body activities by transmitting signals using neurons.',
        description: 'The nervous system is divided into the central nervous system (the brain and spinal cord) and the peripheral nervous system (the nerves that connect the central nervous system to the rest of the body). It detects changes inside and outside the body, processes that information, and sends signals that control muscles and glands. Its signaling cells are neurons, which are supported by glial cells.',
        functions: ['Sensory input: detecting stimuli', 'Integration: processing and interpreting information', 'Motor output: triggering responses in muscles and glands', 'Maintaining homeostasis together with the endocrine system'],
        trivia: ['The brain contains about 86 billion neurons.', 'Myelin wraps around axons, insulating them and speeding up nerve signals.', 'Gray matter is mostly neuron cell bodies, while white matter is mostly myelinated axons, which give it its pale color.', 'The spinal cord carries signals between the brain and the body and handles some reflexes on its own.'],
        sources: [openstax(12, 'The Nervous System and Nervous Tissue')]
    },
    {
        id: 'reproductive',
        summary: 'Produces sex cells and hormones and, in females, supports the development of offspring.',
        description: 'The reproductive system differs between males and females. In males, the testes produce sperm and testosterone, and a series of ducts and glands carries sperm out of the body. In females, the ovaries produce oocytes (eggs) and the hormones estrogen and progesterone, while the uterine tubes, uterus and vagina support fertilization, pregnancy and birth.',
        functions: ['Produces gametes: sperm in males and oocytes in females', 'Produces sex hormones such as testosterone, estrogen and progesterone', 'Delivers gametes so that fertilization can occur', 'Supports the growth of the embryo and fetus in the uterus'],
        trivia: ['Sperm are produced in the seminiferous tubules of the testes.', 'The testes sit in the scrotum, outside the abdomen, because sperm develop best slightly below body temperature.', 'Fertilization usually takes place in the uterine tube, not in the uterus.', 'A female is born with all the primary oocytes she will ever have.'],
        sources: [openstax(27, 'The Reproductive System')]
    },
    {
        id: 'endocrine',
        summary: 'Releases hormones that regulate growth, metabolism and many other body processes.',
        description: 'The endocrine system is made up of glands and cells that release hormones into the blood. Major endocrine glands include the pituitary, thyroid, parathyroid, adrenal and pineal glands, and organs such as the pancreas, ovaries and testes also release hormones. Hormones travel throughout the body but act only on cells that have matching receptors. Their effects start more slowly than nerve signals but last longer.',
        functions: ['Regulates metabolism and energy use', 'Controls growth and development', 'Maintains water, salt and blood sugar balance', 'Coordinates the body\'s response to stress', 'Regulates reproduction'],
        trivia: ['The hypothalamus links the nervous and endocrine systems by controlling the pituitary gland.', 'The pancreas is both a digestive and an endocrine organ: its pancreatic islets release insulin and glucagon.', 'Hormones affect only target cells that have receptors for them.', 'The thyroid gland needs iodine to make its hormones.', 'Most hormone levels are kept in range by negative feedback.'],
        sources: [openstax(17, 'The Endocrine System')]
    },
    {
        id: 'lymphatic',
        summary: 'Returns excess tissue fluid to the blood and helps the body fight infection.',
        description: 'The lymphatic system is a network of lymphatic vessels, lymph nodes and lymphoid organs such as the spleen, thymus and tonsils. It collects fluid that leaks out of blood capillaries into the tissues and returns it, as lymph, to the bloodstream. On the way, lymph passes through lymph nodes, where immune cells check it for pathogens.',
        functions: ['Returns excess interstitial fluid to the blood', 'Absorbs dietary fats from the small intestine', 'Filters lymph through lymph nodes', 'Houses and transports lymphocytes that defend against infection'],
        trivia: ['Lymph has no pump of its own; it is moved along by skeletal muscle contraction, breathing and one-way valves.', 'T cells mature in the thymus.', 'The spleen filters the blood and removes old red blood cells.', 'The thoracic duct, the largest lymphatic vessel, drains lymph from most of the body into the left subclavian vein.'],
        sources: [openstax(21, 'The Lymphatic and Immune System')]
    }
];

// Setup text written by database/integrate_layers.php and integrate_skeleton.php is viewer instructions,
// not anatomy, so it does not replace the curated description.
const GENERATED_DESCRIPTION = /^Explore the (?:.+ in the layered body model|supplied human skeleton model)\./;

// Combines an AnatomyData system (database row, see assets/js/anatomy.js) with its static entry
// into the shape the panel renders. The engine keeps using the raw database system.
export function mergeSystem(db) {
    const extra = systems.find(s => s.id === db.id) || {};
    const trimmed = String(db.description || '').trim();
    const ownDescription = GENERATED_DESCRIPTION.test(trimmed) ? '' : trimmed;
    const description = ownDescription || extra.description || '';
    return {
        id: db.id,
        system_id: db.system_id,
        name: db.name,
        isActive: db.isActive,
        color: db.color,
        summary: extra.summary || firstSentence(description),
        description,
        functions: extra.functions ? [...extra.functions] : [],
        structures: (db.structures || []).map((s, index) => ({
            id: s.mesh_name || `structure-${index}`,
            name: s.name || '',
            meshName: s.mesh_name || '',
            description: s.desc || ''
        })),
        trivia: [...(extra.trivia || []), ...Object.entries(db.keyFacts || {}).map(([label, value]) => `${label}: ${value}`)],
        sources: extra.sources ? extra.sources.map(s => ({...s})) : [],
        sourceNote: db.source || '',
        modelUrl: db.modelUrl || null
    };
}
