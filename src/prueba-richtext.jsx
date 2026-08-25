// TEMPORAL: banco de pruebas del componente RichText. Se borra al terminar.
import { createRoot } from "react-dom/client";
import { RichText } from "./InteractiveVideoPlayer.jsx";

const CASOS = [
  ["plano",            "Texto sin ningun formato."],
  ["negrita",          "Esto es **negrita** en el medio."],
  ["cursiva-asterisco","Esto es *cursiva* con asterisco."],
  ["cursiva-guion",    "Esto es _cursiva_ con guion bajo."],
  ["combinado",        "Hay **negrita** y _cursiva_ en la misma linea."],
  ["dos-parrafos",     "Primer parrafo.\n\nSegundo parrafo."],
  ["tres-parrafos",    "Uno.\n\nDos.\n\nTres."],
  ["salto-simple",     "Linea uno.\nLinea dos."],
  ["parrafo-y-salto",  "Parrafo uno, linea A.\nLinea B.\n\nParrafo dos."],
  ["blanco-con-espacios","Uno.\n   \nDos."],
  ["formato-multiparrafo","**Titulo** del primer parrafo.\n\nY _algo_ en el segundo."],
  ["asterisco-suelto", "2 * 3 = 6 y nada mas."],
  ["guion-en-palabra", "El archivo se llama hub_student_identity y no es cursiva."],
  ["metas-varias",     "Lee hub_student_fullname, hub_is_gift y _hub_student_dni sin romperse."],
  ["cursiva-real",     "Esto _si_ es cursiva porque hay espacios."],
  ["cursiva-puntuada", "Al final de la oracion va _asi_. Y entre parentesis (_asi_) tambien."],
  ["guion-inicial",    "_hub_is_gift empieza con guion bajo."],
  ["mezcla-real",      "El campo _idnumber_ guarda el DNI, igual que hub_course_map."],
  ["vacio",            ""],
  ["solo-espacios",    "   \n  "],
  ["html-crudo",       "Esto tiene <b>html</b> y <script>alert(1)</script> adentro."],
];

createRoot(document.getElementById("root")).render(
  <div>
    {CASOS.map(([nombre, texto]) => (
      <div key={nombre} data-caso={nombre} style={{border:"1px solid #ccc",margin:"6px",padding:"6px"}}>
        <RichText className="caso-cuerpo">{texto}</RichText>
      </div>
    ))}
  </div>
);
