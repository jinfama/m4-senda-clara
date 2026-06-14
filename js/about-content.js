/* about-content.js — Methodology content for the About page */

export const METHODOLOGY = {
    clima: {
        brief: 'Series mensuales y anuales de temperatura y precipitación, 1916-2023, para 785 municipios. Fuentes: MOPREDAS/MOTEDAS y WorldClim.',
        detail: `
            <h3>Clima (1916-2023)</h3>
            <p>Series mensuales y anuales de temperatura y precipitación para los 785 municipios de Andalucía.</p>

            <h4>Fuentes originales</h4>
            <p>Los datos primarios proceden de tres bases de datos externas:</p>
            <ul>
                <li><strong>MOPREDAS</strong> (precipitación, 1916-2020): datos de estaciones pluviométricas interpolados a malla de 10&nbsp;km por González-Hidalgo, J.C. <em>et al.</em> Citar como: González-Hidalgo, J.C., Brunetti, M. &amp; de Luis, M. (2011). <em>A new tool for monthly precipitation analysis in Spain: MOPREDAS database.</em> International Journal of Climatology, 31(9), 1342-1352.</li>
                <li><strong>MOTEDAS</strong> (temperatura media, 1916-2020): datos de estaciones termométricas interpolados a malla de 10&nbsp;km por González-Hidalgo, J.C. <em>et al.</em> Citar como: González-Hidalgo, J.C., Peña-Angulo, D., Brunetti, M. &amp; Cortesi, N. (2015). <em>MOTEDAS: a new monthly temperature database for mainland Spain.</em> International Journal of Climatology, 35(14), 4444-4463.</li>
                <li><strong>WorldClim v2.1</strong> (1950-2023): datos globales de alta resolución (~1&nbsp;km). Proporciona tmin (1950-2014), tmax (1950-2023) y precipitación (1950-2023). Citar como: Fick, S.E. &amp; Hijmans, R.J. (2017). <em>WorldClim 2: new 1-km spatial resolution climate surfaces.</em> International Journal of Climatology, 37(12), 4302-4315.</li>
            </ul>

            <h4>Procesamiento realizado para este visor</h4>
            <p>A partir de las fuentes anteriores, el equipo del proyecto ha realizado las siguientes operaciones:</p>
            <ul>
                <li>Agregación espacial de las mallas originales a nivel municipal, comarcal, provincial y regional, ponderando por superficie.</li>
                <li>Empalme temporal de MOPREDAS/MOTEDAS (1916-2020) con WorldClim (2021-2023) para obtener series continuas.</li>
                <li>Estimación de la temperatura media para 2021-2023 a partir de la relación histórica entre tmax y tmean en el periodo de solapamiento.</li>
                <li>Cálculo de anomalías térmicas respecto a la media del periodo completo (franjas térmicas).</li>
                <li>Construcción de climogramas (precipitación + temperatura) y ciclos anuales superpuestos.</li>
            </ul>

            <h4>Cómo citar</h4>
            <p>Si se utilizan datos de un año o periodo concreto, citar la fuente original correspondiente (MOPREDAS, MOTEDAS o WorldClim). Si se utiliza la serie municipal completa procesada, citar como:</p>
            <p class="method-cite">Infante-Amate, J. (2026). <em>Atlas Histórico Municipal de Andalucía: datos climáticos 1916-2023</em>. Universidad de Granada. [En preparación]</p>
        `,
    },
    poblacion: {
        brief: 'Series anuales de población, dispersión y ruralidad, 1750-2024, para 785 municipios. Fuentes: INE, Goerlich-BBVA, censos históricos.',
        detail: `
            <h3>Población total (1750-2024)</h3>
            <p>Series anuales de población para los 785 municipios de Andalucía (275 años continuos), armonizadas a los límites municipales de 2024. Se combinan cuatro fuentes principales por orden de prioridad:</p>
            <ul>
                <li><strong>Padrón Continuo INE</strong> (1996-2024): datos anuales oficiales, 785 municipios.</li>
                <li><strong>Series Homogéneas Goerlich-BBVA</strong> (1900-2011, decenal): municipios en límites actuales, cobertura 100%. Citar como: Goerlich, F.J., Ruiz, F., Chorén, P. y Albert, C. (2015). <em>Cambios en la estructura y localización de la población.</em> Fundación BBVA/IVIE.</li>
                <li><strong>Censos INE</strong> (1842-1897): datos decenales originales, cobertura parcial (~400-700 municipios).</li>
                <li><strong>Fuentes históricas</strong> (1750, 1787): Catastro de Ensenada, Censo de Floridablanca. García Montoro, J.L., ~700 municipios.</li>
            </ul>

            <h4>Procesamiento realizado para este visor</h4>
            <p>A partir de 46 años con datos censales, las series anuales (275 años) se obtienen por interpolación lineal. Se aplica detección de outliers por tasa compuesta anualizada (&gt;5%/año en patrón spike) con corrección por interpolación ponderada. Los 33 casos de segregaciones municipales post-1981 se ajustan redistribuyendo proporcionalmente. Los datos se agregan bottom-up a comarca, provincia y Andalucía.</p>
            <p><strong>Gaps temporales:</strong> 1787-1842 (55 años, mayor incertidumbre), 1842-1857 (15 años). Los valores entre gaps se obtienen por interpolación lineal sin extrapolación fuera del rango.</p>

            <h4>Cómo citar</h4>
            <p>Si se utilizan datos de un año censal concreto, citar la fuente original (INE, Goerlich-BBVA, etc.). Si se utiliza la serie municipal completa interpolada, citar como:</p>
            <p class="method-cite">Infante-Amate, J. (2026). <em>Atlas Histórico Municipal de Andalucía: series de población 1750-2024</em>. Universidad de Granada. [En preparación]</p>

            <h3>Dispersión / Concentración (1858-2024)</h3>
            <p>Porcentaje de la población municipal que reside fuera del núcleo principal (<em>población dispersa</em>) frente a la que reside en él (<em>población concentrada</em>).</p>
            <p><strong>Definición:</strong> El núcleo principal es la entidad singular más poblada de cada municipio. La población dispersa incluye el resto de entidades y la población diseminada.</p>
            <p><strong>Fuentes:</strong> Datos de Martínez de la Fuente, J.L. para 1858, 1888, 1910, 1930, 1960; Nomenclátor INE para 1981, 1991, 1996, 2000, 2005, 2020, 2024. Interpolación lineal entre años conocidos.</p>

            <h4>Procesamiento para este visor</h4>
            <p>Las series originales, que cubren años puntuales, se han interpolado linealmente para generar series anuales continuas y se han extendido hasta 2024 con datos del Nomenclátor INE.</p>

            <h4>Referencia</h4>
            <p class="method-cite">Martínez de la Fuente, Juan Luis; Infante-Amate, Juan &amp; Travieso, Emiliano (2024). &laquo;Historical changes in Mediterranean rural settlements (southern Spain, 1787-2019).&raquo; <em>Journal of Rural Studies</em>, 106, 103217. <a href="https://doi.org/10.1016/j.jrurstud.2024.103217" target="_blank">DOI: 10.1016/j.jrurstud.2024.103217</a></p>

            <h3>Rural / Urbano (cuatro criterios)</h3>
            <p>Porcentaje de la población que reside en municipios clasificados como rurales según cuatro umbrales alternativos:</p>
            <ul>
                <li><strong>Pob &lt; 5.000</strong> y <strong>Pob &lt; 10.000:</strong> municipios con población total inferior al umbral.</li>
                <li><strong>Núcleo &lt; 5.000</strong> y <strong>Núcleo &lt; 10.000:</strong> municipios cuyo núcleo principal tiene menos del umbral.</li>
            </ul>
            <p>A nivel municipal el indicador es binario (100% rural o 0%). A niveles superiores indica el porcentaje de la población total que vive en municipios clasificados como rurales.</p>

            <h4>Procesamiento para este visor</h4>
            <p>Se han aplicado los cuatro umbrales de ruralidad a las series anuales de población total y de entidades singulares, generando series anuales continuas 1858-2024 a todos los niveles territoriales.</p>

            <h4>Referencia</h4>
            <p class="method-cite">Travieso, Emiliano; Martínez de la Fuente, Juan Luis &amp; Infante-Amate, Juan (2025). &laquo;What counts as rural? Evidence from Southern Spain, 1787-2017.&raquo; <em>Historical Methods</em>. <a href="https://doi.org/10.1080/01615440.2025.2557998" target="_blank">DOI: 10.1080/01615440.2025.2557998</a></p>
        `,
    },
    empleo: {
        brief: 'Estructura sectorial del empleo (agricultura, industria, servicios), 1787-2023, para 785 municipios. Censos históricos, RegData FEDEA-BBVA, Atlas IECA.',
        detail: `
            <h3>Empleo sectorial (1787-2023)</h3>
            <p>Panel completo de empleo sectorial para los 785 municipios andaluces en límites actuales (2024), con tres sectores: agricultura, industria y servicios. Cobertura: 237 años anuales continuos sin celdas vacías.</p>

            <h4>Fuentes municipales (benchmarks censales)</h4>
            <ul>
                <li><strong>Floridablanca 1787:</strong> 693 municipios con dato directo de ocupados varones por oficio (23 categorías → 3 sectores); 92 imputados con media provincial.</li>
                <li><strong>Censo 1900 (INE):</strong> 8 capitales de provincia, población activa por sector.</li>
                <li><strong>Censo 1960 (INE):</strong> 107 municipios (&gt;10.000 hab.), 12 grupos profesionales → 3 sectores.</li>
                <li><strong>Censo 1991 (INE):</strong> 766 municipios, CNAE-74 (divisiones 01-99).</li>
                <li><strong>Censo 2001 (IECA):</strong> 770 municipios, CNAE-93 (4 sectores → 3).</li>
                <li><strong>Censo Anual 2021-2023 (INE):</strong> 676 municipios (&gt;500 hab.), CNAE-09.</li>
            </ul>

            <h4>Fuentes provinciales (proxy temporal)</h4>
            <ul>
                <li><strong>Atlas IECA — Gálvez Muñoz</strong> (1900-2001, decenal): activos por sector. Cuadro 5.2.1 de <em>Estadísticas históricas del mercado de trabajo en Andalucía</em>.</li>
                <li><strong>RegData FEDEA-BBVA</strong> (1955-2023, anual): ocupados por sector para Andalucía. De la Fuente &amp; Ruiz (2025), v7.0.</li>
                <li><strong>Prados de la Escosura</strong> (1850-2024, anual): empleo FTE nacional como proxy para annualizar benchmarks pre-1955.</li>
                <li><strong>CRE</strong> (2000-2021, anual): empleos provinciales. <strong>EPA</strong> (1976-2025): ocupados provinciales.</li>
                <li><strong>Alcaide Inchausti</strong> (1930-2000, quinquenal): estimaciones econométricas de empleos provinciales.</li>
            </ul>

            <h4>Método de interpolación</h4>
            <p>La construcción del panel sigue un procedimiento en cinco pasos:</p>
            <ol>
                <li><strong>Serie anual de Andalucía:</strong> se combina RegData (1955-2023) con benchmarks decenales del Atlas annualizados mediante la variación interanual de la serie nacional de Prados (1900-1954). Se aplica corrección de anclaje entre conceptos (activos → ocupados) con atenuación lineal hacia el pasado.</li>
                <li><strong>Ratios provinciales:</strong> para cada provincia se calcula el ratio respecto a Andalucía en años con benchmark (Atlas, EPA, CRE, Floridablanca), y se interpola linealmente. Los ratios se multiplican por la serie anual regional para obtener series provinciales anuales.</li>
                <li><strong>Interpolación municipal:</strong> interpolación lineal (<em>fill_linear</em>) de la composición sectorial (<code>pct_sector</code>) entre benchmarks censales propios de cada municipio, seguida de escalado multiplicativo uniforme a la serie provincial calibrada para garantizar consistencia jerárquica perfecta.</li>
                <li><strong>Share industria/servicios:</strong> se interpola la proporción <code>industria / (industria + servicios)</code> entre benchmarks propios, y se aplica sobre <code>100 - pct_agricultura</code> para derivar industria y servicios por separado, garantizando que sumen 100%.</li>
                <li><strong>Números absolutos:</strong> se calculan mediante la tasa de actividad provincial interpolada: <code>n_sector = pct_sector × tasa_actividad_prov × población</code>.</li>
            </ol>

            <h4>Clasificación sectorial</h4>
            <table class="method-table">
                <tr><th>Sector</th><th>Contenido</th></tr>
                <tr><td>Agricultura</td><td>Agricultura, ganadería, pesca e industrias extractivas</td></tr>
                <tr><td>Industria</td><td>Manufactura, construcción y energía</td></tr>
                <tr><td>Servicios</td><td>Comercio, transporte, hostelería, administración pública y demás actividades terciarias</td></tr>
            </table>

            <h4>Indicadores de calidad</h4>
            <table class="method-table">
                <tr><th>Indicador</th><th>Valor</th></tr>
                <tr><td>Salto anual mediano</td><td>0,18 pp</td></tr>
                <tr><td>Salto anual P95</td><td>1,75 pp</td></tr>
                <tr><td>Correlación benchmarks censo 1991</td><td>0,9998</td></tr>
                <tr><td>Cobertura municipio-años</td><td>186.045 / 186.045 (100%)</td></tr>
                <tr><td>Consistencia jerárquica</td><td>Perfecta (mun = comarca = provincia)</td></tr>
            </table>

            <h4>Limitaciones</h4>
            <ul>
                <li>Las fuentes miden conceptos distintos (ocupados, activos, empleos FTE). Los porcentajes sectoriales son razonablemente comparables; los números absolutos, menos.</li>
                <li>Brecha 1787-1900: 113 años sin benchmark municipal (salvo capitales en 1900); depende del proxy provincial.</li>
                <li>109 municipios (&lt;500 hab.) extrapolados desde su último benchmark (2001).</li>
                <li>La construcción se incluye en industria para maximizar la comparabilidad temporal con fuentes del XVIII-XIX.</li>
                <li>Floridablanca (1787) solo contabiliza varones adultos, lo que subestima la actividad en sectores con alta participación femenina.</li>
            </ul>

            <h4>Cómo citar</h4>
            <p class="method-cite">Infante-Amate, Juan (2026). <em>Base de datos de empleo histórico municipal de Andalucía (1787-2023)</em>. Universidad de Granada. [En preparación]</p>
        `,
    },
    suelo: {
        brief: 'Datos de uso del suelo próximamente.',
        detail: '<h3>Uso del suelo</h3><p>Información próximamente.</p>',
    },
    agraria: {
        brief: 'Datos de estructura agraria próximamente.',
        detail: '<h3>Agraria</h3><p>Información próximamente.</p>',
    },
    transportes: {
        brief: 'Palimpsesto de infraestructuras de transporte en Andalucía desde la época romana hasta la actualidad.',
        detail: '<h3>Transportes — Palimpsesto</h3>'
            + '<p>Visualización de capas geográficas de infraestructuras de transporte históricas y actuales. El concepto de <em>palimpsesto</em> refleja la superposición de redes viarias de distintas épocas sobre el mismo territorio.</p>'
            + '<h4>Capas disponibles</h4>'
            + '<ul>'
            + '<li><strong>Época Romana:</strong> Calzadas romanas reconstruidas a partir de fuentes arqueológicas e itinerarios clásicos.</li>'
            + '<li><strong>Edad Moderna:</strong> Rutas de Villuga (1543), caminos borbónicos (s. XVIII), ciudades y puertos del periodo.</li>'
            + '<li><strong>Vías Pecuarias:</strong> Red histórica de cañadas, cordeles y veredas para trashumancia.</li>'
            + '<li><strong>Ferrocarril:</strong> Líneas y estaciones ferroviarias con fechas de apertura y cierre.</li>'
            + '<li><strong>Red Viaria:</strong> Carreteras principales, autonómicas y red JRC (1955-2012) de la Comisión Europea.</li>'
            + '<li><strong>Marítima y Aérea:</strong> Puertos (comerciales, pesqueros, deportivos), aeropuertos y faros.</li>'
            + '<li><strong>Vías Verdes:</strong> Antiguas líneas de ferrocarril reconvertidas en senderos y ciclovías.</li>'
            + '</ul>'
            + '<h4>Fuentes</h4>'
            + '<p>Elaboración propia del Laboratorio de Historia de los Agroecosistemas (UPO), JRC European Commission, IECA, ADIF, Ministerio de Transportes.</p>',
    },
};
